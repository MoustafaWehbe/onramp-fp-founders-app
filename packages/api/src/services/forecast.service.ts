import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { PIPELINE_STAGES } from "../config/crm";
import { fundraisingService } from "./fundraising.service";

const WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
// Progression a deal walks through on the way to closing "passed" is a side
// exit, not a step toward committed, so it is excluded the same way
// PipelineService.getAnalytics excludes it from its own funnel chain.
const PROGRESSION = PIPELINE_STAGES.filter((stage) => stage !== "passed");

function asNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

/** Median of a sample, rounded to one decimal. Null for an empty sample. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(value * 10) / 10;
}

export class ForecastService {
  /**
   * A deterministic days-to-close projection, computed here in TypeScript
   * from real rows never left to the model to estimate from prose. Every
   * input that feeds the final number is returned alongside it so the model
   * explains the figure instead of inventing one, and `confidence`/
   * `insufficientData` say plainly when the sample is too thin to trust.
   */
  async forecastRoundClose(startupId: string, requestedRoundId?: string | null) {
    const round = requestedRoundId
      ? await fundraisingService.getRound(startupId, requestedRoundId)
      : (await fundraisingService.listRounds(startupId, { page: 1, limit: 1, status: "active" as any })).data[0];
    if (!round) return { round: null, insufficientData: true, confidence: "low" as const };

    const metrics = await fundraisingService.getRoundMetrics(startupId, round.id);
    const cutoff = new Date(Date.now() - WINDOW_DAYS * DAY_MS);

    const [events, softCommitments, liveDealsPastContacted, bankableCommitmentAmounts] = await Promise.all([
      prisma.pipelineStageEvent.findMany({
        where: { startupId, roundId: round.id, createdAt: { gte: cutoff } },
        orderBy: { createdAt: "asc" },
        select: { pipelineId: true, fromStage: true, toStage: true, createdAt: true },
      }),
      prisma.commitment.findMany({
        where: { startupId, roundId: round.id, status: "soft_circled" },
        select: { amount: true },
      }),
      // "Past contacted" excludes sourced/contacted (too early to weight
      // meaningfully) and committed/passed (already counted elsewhere —
      // committed money is in bankableRaised, passed deals are dead).
      prisma.pipeline.findMany({
        where: { startupId, roundId: round.id, stage: { in: ["meeting_scheduled", "due_diligence", "term_sheet"] } },
        select: { expectedAmount: true, probabilityPercentage: true },
      }),
      prisma.commitment.findMany({
        where: { startupId, roundId: round.id, status: { in: ["hard_circled", "wired"] } },
        select: { amount: true },
      }),
    ]);

    const softPipeline =
      softCommitments.reduce((sum, c) => sum + (asNumber(c.amount) ?? 0), 0) +
      liveDealsPastContacted.reduce((sum, deal) => sum + (asNumber(deal.expectedAmount) ?? 0) * ((deal.probabilityPercentage ?? 0) / 100), 0);

    // Per-deal timeline within the window, oldest first (the query is
    // already ordered ascending) used for both stage velocity and
    // stage-reach conversion, the same two derivations
    // PipelineService.getAnalytics makes from the same event shape, just
    // bounded to the trailing window instead of the round's whole history.
    const timelineByDeal = new Map<string, Array<{ toStage: string; at: number }>>();
    const reachedByDeal = new Map<string, Set<string>>();
    for (const event of events) {
      const timeline = timelineByDeal.get(event.pipelineId);
      const point = { toStage: event.toStage, at: event.createdAt.getTime() };
      if (timeline) timeline.push(point);
      else timelineByDeal.set(event.pipelineId, [point]);

      let reached = reachedByDeal.get(event.pipelineId);
      if (!reached) { reached = new Set(); reachedByDeal.set(event.pipelineId, reached); }
      reached.add(event.toStage);
    }

    const durationsByStage = new Map<string, number[]>();
    for (const timeline of timelineByDeal.values()) {
      // Last entry is the stage the deal is sitting in right now still
      // running, so it has no finished duration to contribute.
      for (let i = 0; i < timeline.length - 1; i += 1) {
        const days = (timeline[i + 1].at - timeline[i].at) / DAY_MS;
        const bucket = durationsByStage.get(timeline[i].toStage);
        if (bucket) bucket.push(days);
        else durationsByStage.set(timeline[i].toStage, [days]);
      }
    }
    const stageVelocityDays = Object.fromEntries(PROGRESSION.map((stage) => [stage, median(durationsByStage.get(stage) ?? [])]));

    const rankOf = new Map<string, number>(PROGRESSION.map((stage, index) => [stage, index]));
    const maxRankByDeal = new Map<string, number>();
    for (const [dealId, reached] of reachedByDeal) {
      let maxRank = -1;
      for (const stage of reached) {
        const rank = rankOf.get(stage);
        if (rank !== undefined && rank > maxRank) maxRank = rank;
      }
      if (maxRank >= 0) maxRankByDeal.set(dealId, maxRank);
    }
    const everReached = (stage: string) => {
      const rank = rankOf.get(stage);
      if (rank === undefined) return 0;
      let count = 0;
      for (const maxRank of maxRankByDeal.values()) if (maxRank >= rank) count += 1;
      return count;
    };
    const everAdvancedBeyond = (stage: string) => {
      const rank = rankOf.get(stage);
      if (rank === undefined) return 0;
      let count = 0;
      for (const maxRank of maxRankByDeal.values()) if (maxRank > rank) count += 1;
      return count;
    };
    const conversion = PROGRESSION.slice(0, -1).map((stage, index) => {
      const reached = everReached(stage);
      const advanced = everAdvancedBeyond(stage);
      return { fromStage: stage, toStage: PROGRESSION[index + 1], reached, advanced, rate: reached === 0 ? null : advanced / reached };
    });
    // The whole-funnel probability a brand-new deal eventually reaches
    // committed null (not zero) at the first stage with no observed rate,
    // since "zero conversion" and "no data yet" are different claims.
    const overallConversionRate = conversion.some((leg) => leg.rate === null)
      ? null
      : conversion.reduce((product, leg) => product * (leg.rate as number), 1);

    // Typical calendar time for a new deal to walk the whole path to
    // committed, assuming every leg succeeds treated as null, not summed
    // with a zero stand-in, when any leg has no observed duration yet.
    const stageDurations = PROGRESSION.slice(0, -1).map((stage) => stageVelocityDays[stage]);
    const cycleTimeDays = stageDurations.some((days) => days === null) ? null : stageDurations.reduce((sum: number, days) => sum + (days as number), 0);

    const newDealsPerDay = events.filter((event) => event.fromStage === null).length / WINDOW_DAYS;
    const averageCheckSize = median(bankableCommitmentAmounts.map((c) => asNumber(c.amount)).filter((amount): amount is number => amount !== null));

    const expectedValuePerDay =
      overallConversionRate !== null && averageCheckSize !== null ? newDealsPerDay * overallConversionRate * averageCheckSize : null;
    const projectedDaysToClose =
      expectedValuePerDay !== null && expectedValuePerDay > 0 ? Math.ceil(metrics.remainingGap / expectedValuePerDay) : null;

    // Confidence is a function of how much history actually informed the
    // legs above, not of how confident the resulting number "looks."
    const insufficientData = events.length < 8;
    const confidence: "low" | "medium" | "high" = insufficientData ? "low" : events.length < 40 ? "medium" : "high";

    return {
      round: { id: round.id, name: round.roundName, currency: round.currency },
      targetAmount: metrics.targetAmount,
      committedToDate: metrics.bankableRaised,
      remainingGap: metrics.remainingGap,
      softPipeline,
      projectedDaysToClose,
      confidence,
      insufficientData,
      inputs: {
        windowDays: WINDOW_DAYS,
        stageEventCount: events.length,
        stageVelocityDays,
        conversion,
        overallConversionRate,
        cycleTimeDays,
        newDealsPerDay: Math.round(newDealsPerDay * 1000) / 1000,
        averageCheckSize,
        expectedValuePerDay,
      },
    };
  }
}

export const forecastService = new ForecastService();
