import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import type {
  CreateCommitmentInput,
  CreateFundraisingRoundInput,
  ListCommitmentsQuery,
  ListFundraisingRoundsQuery,
  UpdateCommitmentInput,
  UpdateFundraisingRoundInput,
} from "../validators/fundraising.schemas";

const INVESTOR_SELECT = {
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

const ROUND_SELECT = {
  id: true,
  startupId: true,
  roundName: true,
  targetAmount: true,
  minimumTicketSize: true,
  equityOfferedPercentage: true,
  currency: true,
  status: true,
  firstCloseDate: true,
  targetCloseDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

const COMMITMENT_SELECT = {
  id: true,
  startupId: true,
  startupInvestorId: true,
  pipelineId: true,
  roundId: true,
  amount: true,
  status: true,
  expectedCloseDate: true,
  createdAt: true,
  updatedAt: true,
  startupInvestor: { select: INVESTOR_SELECT },
} as const;

function asNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

function serializeRound(round: Prisma.FundraisingRoundGetPayload<{ select: typeof ROUND_SELECT }>) {
  return {
    ...round,
    targetAmount: asNumber(round.targetAmount),
    minimumTicketSize: asNumber(round.minimumTicketSize),
    equityOfferedPercentage: asNumber(round.equityOfferedPercentage),
  };
}

function serializeCommitment(
  commitment: Prisma.CommitmentGetPayload<{ select: typeof COMMITMENT_SELECT }>,
) {
  const { startupInvestorId, startupInvestor, ...rest } = commitment;
  return {
    ...rest,
    investorId: startupInvestorId,
    investor: startupInvestor,
    amount: asNumber(commitment.amount),
  };
}

export class FundraisingService {
  async listRounds(startupId: string, query: ListFundraisingRoundsQuery) {
    const where = { startupId, ...(query.status && { status: query.status }) };
    const [total, rounds] = await Promise.all([
      prisma.fundraisingRound.count({ where }),
      prisma.fundraisingRound.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: ROUND_SELECT,
      }),
    ]);
    return {
      data: rounds.map(serializeRound),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async getRound(startupId: string, roundId: string) {
    const round = await prisma.fundraisingRound.findUnique({
      where: { startupId_id: { startupId, id: roundId } },
      select: ROUND_SELECT,
    });
    if (!round) throw createError("Fundraising round not found", 404, "FUNDRAISING_ROUND_NOT_FOUND");
    return serializeRound(round);
  }

  async createRound(startupId: string, input: CreateFundraisingRoundInput) {
    const round = await prisma.fundraisingRound.create({
      data: { startupId, ...input },
      select: ROUND_SELECT,
    });
    return serializeRound(round);
  }

  async updateRound(startupId: string, roundId: string, input: UpdateFundraisingRoundInput) {
    await this.getRound(startupId, roundId);
    const round = await prisma.fundraisingRound.update({
      where: { id: roundId },
      data: input,
      select: ROUND_SELECT,
    });
    return serializeRound(round);
  }

  async deleteRound(startupId: string, roundId: string) {
    await this.getRound(startupId, roundId);
    const [pipelineCount, commitmentCount] = await Promise.all([
      prisma.pipeline.count({ where: { startupId, roundId } }),
      prisma.commitment.count({ where: { startupId, roundId } }),
    ]);
    if (pipelineCount || commitmentCount) {
      throw createError(
        "This fundraising round has pipeline entries or commitments and cannot be deleted",
        409,
        "HAS_DEPENDENTS",
      );
    }
    await prisma.fundraisingRound.delete({ where: { id: roundId } });
  }

  async listCommitments(startupId: string, query: ListCommitmentsQuery, roundId?: string) {
    if (roundId) await this.getRound(startupId, roundId);
    const where = {
      startupId,
      ...(roundId && { roundId }),
      ...(query.status && { status: query.status }),
    };
    const [total, commitments] = await Promise.all([
      prisma.commitment.count({ where }),
      prisma.commitment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: COMMITMENT_SELECT,
      }),
    ]);
    return {
      data: commitments.map(serializeCommitment),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async getCommitment(startupId: string, commitmentId: string) {
    const commitment = await prisma.commitment.findFirst({
      where: { id: commitmentId, startupId },
      select: COMMITMENT_SELECT,
    });
    if (!commitment) throw createError("Commitment not found", 404, "COMMITMENT_NOT_FOUND");
    return serializeCommitment(commitment);
  }

  async createCommitment(startupId: string, input: CreateCommitmentInput, userId?: string) {
    const [investor, round, pipeline] = await Promise.all([
      prisma.startupInvestor.findUnique({
        where: { startupId_id: { startupId, id: input.investorId } },
        select: { id: true },
      }),
      prisma.fundraisingRound.findUnique({
        where: { startupId_id: { startupId, id: input.roundId } },
        select: { id: true },
      }),
      prisma.pipeline.findFirst({
        where: {
          id: input.pipelineId,
          startupId,
          roundId: input.roundId,
          startupInvestorId: input.investorId,
        },
        select: { id: true },
      }),
    ]);
    if (!investor) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");
    if (!round) throw createError("Fundraising round not found", 404, "FUNDRAISING_ROUND_NOT_FOUND");
    if (!pipeline) {
      throw createError(
        "Pipeline entry must belong to the selected investor and fundraising round",
        422,
        "PIPELINE_MISMATCH",
      );
    }
    // Recording money against the round is the same event as the deal
    // reaching Committed. PipelineService.updateEntry already writes this
    // link in the other direction; doing it here too is what stops the two
    // pages disagreeing whichever way the founder happens to work.
    const commitment = await prisma.$transaction(async (tx) => {
      const created = await tx.commitment.create({
        data: {
          startupId,
          startupInvestorId: input.investorId,
          pipelineId: input.pipelineId,
          roundId: input.roundId,
          amount: input.amount,
          ...(input.status && { status: input.status }),
          ...(input.expectedCloseDate && { expectedCloseDate: input.expectedCloseDate }),
        },
        select: COMMITMENT_SELECT,
      });

      // The first point in this commitment's funding history — recorded even
      // though nothing has "changed" yet, so the funding chart has somewhere
      // to start from.
      await tx.commitmentStatusEvent.create({
        data: {
          startupId,
          commitmentId: created.id,
          fromStatus: null,
          toStatus: created.status,
          changedBy: userId ?? null,
        },
      });

      if (input.status !== "withdrawn") {
        await this.moveDealToStage(tx, startupId, input.pipelineId, "committed", userId);
      }

      return created;
    });
    return serializeCommitment(commitment);
  }

  /**
   * Move a deal to `stage` and append the matching history row, but only if
   * it is not already there — so re-saving a commitment does not litter the
   * timeline with no-op transitions. Runs inside the caller's transaction.
   */
  private async moveDealToStage(
    tx: Prisma.TransactionClient,
    startupId: string,
    pipelineId: string,
    stage: string,
    userId?: string,
  ): Promise<void> {
    const deal = await tx.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { id: true, stage: true },
    });
    if (!deal || deal.stage === stage) return;

    const changedAt = new Date();
    await tx.pipeline.update({
      where: { id: pipelineId },
      data: { stage, stageChangedAt: changedAt },
    });
    await tx.pipelineStageEvent.create({
      data: {
        startupId,
        pipelineId,
        fromStage: deal.stage,
        toStage: stage,
        changedBy: userId ?? null,
        createdAt: changedAt,
      },
    });
  }

  async updateCommitment(
    startupId: string,
    commitmentId: string,
    input: UpdateCommitmentInput,
    userId?: string,
  ) {
    const existing = await this.getCommitment(startupId, commitmentId);

    const commitment = await prisma.$transaction(async (tx) => {
      const updated = await tx.commitment.update({
        where: { id: commitmentId },
        data: input,
        select: COMMITMENT_SELECT,
      });

      // The funding chart is built from these transitions, not from
      // commitments.createdAt or .updatedAt — an edit that leaves status
      // alone (just the amount, say) is not a new point on that chart.
      if (input.status && input.status !== existing.status) {
        await tx.commitmentStatusEvent.create({
          data: {
            startupId,
            commitmentId,
            fromStatus: existing.status,
            toStatus: input.status,
            changedBy: userId ?? null,
          },
        });
      }

      // The investor backing out has to take the deal off Committed too, or
      // the board keeps claiming money the round no longer counts. Term sheet
      // is where it lands: they had one, then withdrew.
      if (input.status === "withdrawn" && existing.status !== "withdrawn") {
        await this.moveDealToStage(tx, startupId, existing.pipelineId, "term_sheet", userId);
      }
      // Reinstating a withdrawn commitment puts the deal back on Committed.
      if (input.status && input.status !== "withdrawn" && existing.status === "withdrawn") {
        await this.moveDealToStage(tx, startupId, existing.pipelineId, "committed", userId);
      }

      return updated;
    });
    return serializeCommitment(commitment);
  }

  async deleteCommitment(startupId: string, commitmentId: string, userId?: string) {
    const existing = await this.getCommitment(startupId, commitmentId);

    await prisma.$transaction(async (tx) => {
      await tx.commitment.delete({ where: { id: commitmentId } });
      // Nothing records this money any more, so the deal cannot stay on
      // Committed — that is exactly the divergence this link exists to stop.
      if (existing.status !== "withdrawn") {
        await this.moveDealToStage(tx, startupId, existing.pipelineId, "term_sheet", userId);
      }
    });
  }

  /**
   * Every real status transition any commitment in this round has gone
   * through, oldest first — what the funding chart is built from instead of
   * commitments.createdAt. A commitment created as soft-circled and wired a
   * month later shows up here as raising its money in that later month, not
   * the month it was first typed in.
   */
  async getFundingHistory(startupId: string, roundId: string) {
    await this.getRound(startupId, roundId);

    const events = await prisma.commitmentStatusEvent.findMany({
      where: { startupId, commitment: { roundId } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        commitmentId: true,
        fromStatus: true,
        toStatus: true,
        createdAt: true,
        commitment: {
          select: {
            amount: true,
            startupInvestor: { select: { fullName: true } },
          },
        },
      },
    });

    return events.map((event) => ({
      id: event.id,
      commitmentId: event.commitmentId,
      investorName: event.commitment.startupInvestor.fullName,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      amount: asNumber(event.commitment.amount),
      createdAt: event.createdAt,
    }));
  }

  /**
   * The numbers a round's health is judged by, computed once here so
   * Dashboard, Fundraising and anything else showing "this round's numbers"
   * cannot drift apart the way independently-derived client math would.
   */
  async getRoundMetrics(startupId: string, roundId: string) {
    const round = await this.getRound(startupId, roundId);

    const [commitments, liveDeals] = await Promise.all([
      prisma.commitment.findMany({
        where: { startupId, roundId },
        select: {
          id: true,
          amount: true,
          status: true,
          expectedCloseDate: true,
          startupInvestor: { select: { fullName: true } },
        },
      }),
      // Weighted pipeline is what's still uncertain — a committed deal
      // already has an exact commitment amount, so folding its probability
      // weight back in here would count the same money twice, and a passed
      // deal contributes nothing.
      prisma.pipeline.findMany({
        where: { startupId, roundId, stage: { notIn: ["committed", "passed"] } },
        select: { expectedAmount: true, probabilityPercentage: true },
      }),
    ]);

    const sumBy = (predicate: (c: (typeof commitments)[number]) => boolean) =>
      commitments.filter(predicate).reduce((sum, c) => sum + (asNumber(c.amount) ?? 0), 0);

    const wired = sumBy((c) => c.status === "wired");
    const hardCircled = sumBy((c) => c.status === "hard_circled");
    const softCircled = sumBy((c) => c.status === "soft_circled");
    const bankableRaised = wired + hardCircled;
    // Already a plain number: getRound() runs this through serializeRound.
    const target = round.targetAmount ?? 0;

    const weightedPipeline = liveDeals.reduce((sum, deal) => {
      const amount = asNumber(deal.expectedAmount) ?? 0;
      return sum + amount * ((deal.probabilityPercentage ?? 0) / 100);
    }, 0);

    const closeTarget = round.targetCloseDate ?? round.firstCloseDate;
    const daysToClose = closeTarget
      ? Math.ceil((closeTarget.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

    const now = Date.now();
    // At risk: money someone promised by a date that has already passed and
    // it still is not in the bank. Withdrawn is its own, already-visible
    // signal and does not need flagging again here.
    const atRiskCommitments = commitments
      .filter(
        (c) =>
          c.status !== "wired" &&
          c.status !== "withdrawn" &&
          c.expectedCloseDate !== null &&
          c.expectedCloseDate.getTime() < now,
      )
      .map((c) => ({
        id: c.id,
        investorName: c.startupInvestor.fullName,
        amount: asNumber(c.amount),
        status: c.status,
        expectedCloseDate: c.expectedCloseDate,
        daysOverdue: Math.floor((now - c.expectedCloseDate!.getTime()) / (24 * 60 * 60 * 1000)),
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    return {
      currency: round.currency,
      targetAmount: target,
      wired,
      hardCircled,
      softCircled,
      bankableRaised,
      remainingGap: Math.max(0, target - bankableRaised),
      percentToTarget: target > 0 ? Math.min(100, Math.round((bankableRaised / target) * 100)) : 0,
      weightedPipeline,
      daysToClose,
      atRiskCommitments,
    };
  }
}

export const fundraisingService = new FundraisingService();
