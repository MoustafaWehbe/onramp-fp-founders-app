import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { PIPELINE_STAGES } from "../config/crm";
import { createError } from "../utils/errors";
import type {
  CreatePipelineEntryInput,
  UpdatePipelineEntryInput,
  ListPipelineQuery,
} from "../validators/pipeline.schemas";

const CONTACT_SELECT = {
  id: true,
  startupId: true,
  fullName: true,
  email: true,
  ventureFirm: true,
  investorType: true,
  sectorFocus: true,
  investmentStagePreference: true,
  linkedinUrl: true,
  notes: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ENTRY_SELECT = {
  id: true,
  startupId: true,
  startupInvestorId: true,
  stage: true,
  expectedAmount: true,
  probabilityPercentage: true,
  sortOrder: true,
  stageChangedAt: true,
  createdAt: true,
  updatedAt: true,
  startupInvestor: { select: CONTACT_SELECT },
} as const;

/** Gap between freshly-appended cards — wide enough that inserting between two
 *  of them by averaging never needs a follow-up renumbering pass. */
const SORT_ORDER_STEP = 1000;

type EntryRow = {
  id: string;
  startupId: string;
  startupInvestorId: string;
  stage: string;
  expectedAmount: Prisma.Decimal | null;
  probabilityPercentage: number | null;
  sortOrder: number;
  stageChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  startupInvestor: {
    id: string;
    startupId: string;
    fullName: string;
    email: string | null;
    ventureFirm: string | null;
    investorType: string | null;
    sectorFocus: string | null;
    investmentStagePreference: string | null;
    linkedinUrl: string | null;
    notes: string | null;
    source: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
};

// Decimal serializes to a JSON string; openapi documents expectedAmount as number.
function serializeEntry(entry: EntryRow) {
  return {
    id: entry.id,
    startupId: entry.startupId,
    investorId: entry.startupInvestorId,
    investor: entry.startupInvestor,
    stage: entry.stage,
    expectedAmount: entry.expectedAmount === null ? null : Number(entry.expectedAmount),
    probabilityPercentage: entry.probabilityPercentage,
    sortOrder: entry.sortOrder,
    stageChangedAt: entry.stageChangedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/** Median of a sample, rounded to one decimal. Null for an empty sample. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(value * 10) / 10;
}

export class PipelineService {
  async createEntry(startupId: string, input: CreatePipelineEntryInput, userId?: string) {
    const contact = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: input.investorId } },
      select: { id: true },
    });
    if (!contact) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");

    try {
      // The entry and its opening history row must land together, or analytics
      // silently under-counts every deal whose event write failed.
      const entry = await prisma.$transaction(async (tx) => {
        // New cards join the bottom of their column, same as a fresh Trello/Asana
        // card — after whatever currently has the highest position there.
        const bottom = await tx.pipeline.aggregate({
          where: { startupId, stage: input.stage },
          _max: { sortOrder: true },
        });
        const sortOrder = (bottom._max.sortOrder ?? 0) + SORT_ORDER_STEP;

        const created = await tx.pipeline.create({
          data: {
            startupId,
            startupInvestorId: input.investorId,
            stage: input.stage,
            sortOrder,
            stageChangedAt: new Date(),
            ...(input.expectedAmount !== undefined && { expectedAmount: input.expectedAmount }),
            ...(input.probabilityPercentage !== undefined && {
              probabilityPercentage: input.probabilityPercentage,
            }),
          },
          select: ENTRY_SELECT,
        });

        await tx.pipelineStageEvent.create({
          data: {
            startupId,
            pipelineId: created.id,
            fromStage: null,
            toStage: created.stage,
            changedBy: userId ?? null,
            createdAt: created.stageChangedAt,
          },
        });

        return created;
      });

      return serializeEntry(entry);
    } catch (err) {
      throw this.translateDuplicatePipeline(err);
    }
  }

  async listEntries(startupId: string, query: ListPipelineQuery) {
    const { page, limit, stage } = query;

    const where: Prisma.PipelineWhereInput = {
      startupId,
      ...(stage && { stage }),
    };

    const [total, rows] = await Promise.all([
      prisma.pipeline.count({ where }),
      prisma.pipeline.findMany({
        where,
        // sortOrder is the manually-arranged position within a stage; it's the
        // canonical order for a Kanban board, not a byproduct of last edit time.
        orderBy: { sortOrder: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        select: ENTRY_SELECT,
      }),
    ]);

    return {
      data: rows.map(serializeEntry),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getEntry(startupId: string, pipelineId: string) {
    const entry = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: ENTRY_SELECT,
    });
    if (!entry) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");
    return serializeEntry(entry);
  }

  async updateEntry(
    startupId: string,
    pipelineId: string,
    input: UpdatePipelineEntryInput,
    userId?: string,
  ) {
    const existing = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { id: true, stage: true },
    });
    if (!existing) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");

    // Editing an amount is not a stage move; only a real transition advances the
    // clock and appends history.
    const movedTo =
      input.stage !== undefined && input.stage !== existing.stage ? input.stage : null;

    if (movedTo === null) {
      const entry = await prisma.pipeline.update({
        where: { id: pipelineId },
        data: input,
        select: ENTRY_SELECT,
      });
      return serializeEntry(entry);
    }

    const changedAt = new Date();
    const entry = await prisma.$transaction(async (tx) => {
      const updated = await tx.pipeline.update({
        where: { id: pipelineId },
        data: { ...input, stageChangedAt: changedAt },
        select: ENTRY_SELECT,
      });

      await tx.pipelineStageEvent.create({
        data: {
          startupId,
          pipelineId,
          fromStage: existing.stage,
          toStage: movedTo,
          changedBy: userId ?? null,
          createdAt: changedAt,
        },
      });

      return updated;
    });

    return serializeEntry(entry);
  }

  async deleteEntry(startupId: string, pipelineId: string) {
    const existing = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { id: true },
    });
    if (!existing) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");

    // Phase 5 Commitments FK onto pipeline — guard now so Phase 5 does not retrofit it.
    const commitmentCount = await prisma.commitment.count({
      where: { pipelineId, startupId },
    });
    if (commitmentCount > 0) {
      throw createError(
        "This pipeline entry has related commitments and cannot be deleted",
        409,
        "HAS_DEPENDENTS",
      );
    }

    await prisma.pipeline.delete({ where: { id: pipelineId } });
  }

  /**
   * Funnel, conversion and velocity, computed from the append-only stage
   * history rather than from current state. Current state alone cannot tell you
   * that a deal now marked "passed" once reached diligence, and deals can be
   * added at any stage — so a snapshot would invent transitions.
   *
   * Deals that predate the history table contribute a single "joined" event
   * from the backfill, so they count toward funnel reach but show no movement
   * until they are next touched.
   */
  async getAnalytics(startupId: string) {
    const [entries, events] = await Promise.all([
      prisma.pipeline.findMany({
        where: { startupId },
        select: { id: true, stage: true, expectedAmount: true, stageChangedAt: true },
      }),
      prisma.pipelineStageEvent.findMany({
        where: { startupId },
        orderBy: { createdAt: "asc" },
        select: { pipelineId: true, toStage: true, createdAt: true },
      }),
    ]);

    const progression = PIPELINE_STAGES.filter((stage) => stage !== "passed");
    const rankOf = new Map<string, number>(progression.map((stage, index) => [stage, index]));

    // Per deal: which stages it ever occupied, and how long each finished visit lasted.
    const reachedByDeal = new Map<string, Set<string>>();
    const eventsByDeal = new Map<string, { toStage: string; at: number }[]>();

    for (const event of events) {
      let reached = reachedByDeal.get(event.pipelineId);
      if (!reached) {
        reached = new Set<string>();
        reachedByDeal.set(event.pipelineId, reached);
      }
      reached.add(event.toStage);

      const timeline = eventsByDeal.get(event.pipelineId);
      const point = { toStage: event.toStage, at: event.createdAt.getTime() };
      if (timeline) timeline.push(point);
      else eventsByDeal.set(event.pipelineId, [point]);
    }

    const durationsByStage = new Map<string, number[]>();
    for (const timeline of eventsByDeal.values()) {
      // The last entry is the stage the deal sits in now — that visit is still
      // running, so it would drag every median down if counted.
      for (let i = 0; i < timeline.length - 1; i += 1) {
        const days = (timeline[i + 1].at - timeline[i].at) / (24 * 60 * 60 * 1000);
        const bucket = durationsByStage.get(timeline[i].toStage);
        if (bucket) bucket.push(days);
        else durationsByStage.set(timeline[i].toStage, [days]);
      }
    }

    const currentByStage = new Map<string, { count: number; value: number }>();
    for (const entry of entries) {
      const bucket = currentByStage.get(entry.stage) ?? { count: 0, value: 0 };
      bucket.count += 1;
      bucket.value += entry.expectedAmount === null ? 0 : Number(entry.expectedAmount);
      currentByStage.set(entry.stage, bucket);
    }

    // A deal added directly at, say, Diligence has no recorded "sourced" or
    // "meeting_scheduled" events — only its highest rank reached tells us it
    // implicitly cleared every earlier stage too. Without this, funnel counts
    // stop being monotonic (a later stage can outnumber an earlier one) the
    // moment any deal skips stages, which breaks the funnel shape itself.
    const maxRankByDeal = new Map<string, number>();
    for (const [dealId, reached] of reachedByDeal) {
      let maxRank = -1;
      for (const s of reached) {
        const rank = rankOf.get(s);
        if (rank !== undefined && rank > maxRank) maxRank = rank;
      }
      if (maxRank >= 0) maxRankByDeal.set(dealId, maxRank);
    }

    const everReached = (stage: string) => {
      if (stage === "passed") {
        let count = 0;
        for (const reached of reachedByDeal.values()) if (reached.has("passed")) count += 1;
        return count;
      }
      const rank = rankOf.get(stage);
      if (rank === undefined) return 0;
      let count = 0;
      for (const maxRank of maxRankByDeal.values()) if (maxRank >= rank) count += 1;
      return count;
    };

    /** Deals that reached `stage` and later occupied anything further along. */
    const everAdvancedBeyond = (stage: string) => {
      const rank = rankOf.get(stage);
      if (rank === undefined) return 0;
      let count = 0;
      for (const maxRank of maxRankByDeal.values()) if (maxRank > rank) count += 1;
      return count;
    };

    const funnel = PIPELINE_STAGES.map((stage) => {
      const current = currentByStage.get(stage) ?? { count: 0, value: 0 };
      return {
        stage,
        current: current.count,
        currentValue: current.value,
        everReached: everReached(stage),
        medianDaysInStage: median(durationsByStage.get(stage) ?? []),
      };
    });

    const conversion = progression.slice(0, -1).map((stage, index) => {
      const reached = everReached(stage);
      const advanced = everAdvancedBeyond(stage);
      return {
        fromStage: stage,
        toStage: progression[index + 1],
        reached,
        advanced,
        rate: reached === 0 ? null : advanced / reached,
      };
    });

    const committed = currentByStage.get("committed")?.count ?? 0;
    const passed = currentByStage.get("passed")?.count ?? 0;
    const decided = committed + passed;

    return {
      data: {
        totalDeals: entries.length,
        funnel,
        conversion,
        outcomes: {
          open: entries.length - decided,
          committed,
          passed,
          winRate: decided === 0 ? null : committed / decided,
        },
      },
    };
  }

  /**
   * The full stage history for one deal — who added it (the first event,
   * fromStage null) and who moved it since. Exposed so the UI can answer
   * "who did this" instead of just "what changed", which the board alone
   * cannot show.
   */
  async listStageEvents(startupId: string, pipelineId: string) {
    const entry = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { id: true },
    });
    if (!entry) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");

    const events = await prisma.pipelineStageEvent.findMany({
      where: { startupId, pipelineId },
      orderBy: { createdAt: "asc" },
      select: { id: true, fromStage: true, toStage: true, changedBy: true, createdAt: true },
    });

    return { data: events };
  }

  private translateDuplicatePipeline(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return createError(
        "This investor already has a pipeline entry for this startup",
        409,
        "ALREADY_IN_PIPELINE",
      );
    }
    return err;
  }
}

export const pipelineService = new PipelineService();
