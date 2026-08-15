import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { INITIAL_PIPELINE_STAGES, OPEN_ROUND_STATUSES, PIPELINE_STAGES } from "../config/crm";
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
  notesCreatedAt: true,
  notesCreatedBy: true,
  notesUpdatedAt: true,
  notesUpdatedBy: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ENTRY_SELECT = {
  id: true,
  startupId: true,
  roundId: true,
  startupInvestorId: true,
  stage: true,
  expectedAmount: true,
  probabilityPercentage: true,
  ownerId: true,
  priority: true,
  investorFitScore: true,
  isLead: true,
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
  roundId: string;
  startupInvestorId: string;
  stage: string;
  expectedAmount: Prisma.Decimal | null;
  probabilityPercentage: number | null;
  ownerId: string | null;
  priority: string | null;
  investorFitScore: number | null;
  isLead: boolean;
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
    notesCreatedAt: Date | null;
    notesCreatedBy: string | null;
    notesUpdatedAt: Date | null;
    notesUpdatedBy: string | null;
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
    roundId: entry.roundId,
    investorId: entry.startupInvestorId,
    investor: entry.startupInvestor,
    stage: entry.stage,
    expectedAmount: entry.expectedAmount === null ? null : Number(entry.expectedAmount),
    probabilityPercentage: entry.probabilityPercentage,
    ownerId: entry.ownerId,
    priority: entry.priority,
    investorFitScore: entry.investorFitScore,
    isLead: entry.isLead,
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
    // Validators protect HTTP callers, but services are also used directly by
    // jobs and tests. Do not let either bypass the commitment/pass audit flows.
    if (!(INITIAL_PIPELINE_STAGES as readonly string[]).includes(input.stage)) {
      throw createError(
        "A new deal must start before committed or passed",
        400,
        "INITIAL_STAGE_NOT_ALLOWED",
      );
    }

    const contact = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: input.investorId } },
      select: { id: true },
    });
    if (!contact) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");

    if (input.ownerId) await this.verifyMember(startupId, input.ownerId);

    // Adding outreach is the one path that must refuse a finished raise —
    // reading and editing deals in a closed round has to keep working.
    const roundId = await this.resolveRoundId(startupId, input.roundId, { forNewDeal: true });

    try {
      // The entry and its opening history row must land together, or analytics
      // silently under-counts every deal whose event write failed.
      const entry = await prisma.$transaction(async (tx) => {
        // New cards join the bottom of their column, same as a fresh Trello/Asana
        // card — after whatever currently has the highest position there.
        const bottom = await tx.pipeline.aggregate({
          where: { startupId, roundId, stage: input.stage },
          _max: { sortOrder: true },
        });
        const sortOrder = (bottom._max.sortOrder ?? 0) + SORT_ORDER_STEP;

        const created = await tx.pipeline.create({
          data: {
            startupId,
            roundId,
            startupInvestorId: input.investorId,
            stage: input.stage,
            sortOrder,
            stageChangedAt: new Date(),
            ...(input.expectedAmount !== undefined && { expectedAmount: input.expectedAmount }),
            ...(input.probabilityPercentage !== undefined && {
              probabilityPercentage: input.probabilityPercentage,
            }),
            ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
            ...(input.priority !== undefined && { priority: input.priority }),
            ...(input.investorFitScore !== undefined && {
              investorFitScore: input.investorFitScore,
            }),
            ...(input.isLead !== undefined && { isLead: input.isLead }),
          },
          select: ENTRY_SELECT,
        });

        await tx.pipelineStageEvent.create({
          data: {
            startupId,
            roundId,
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
    const { page, limit, stage, search, ownerId, attentionOnly } = query;
    const roundId = await this.resolveRoundId(startupId, query.roundId);

    // An explicit stage always wins; otherwise showPassed=false excludes the
    // one stage that would otherwise dominate a "what needs work" view.
    const stageFilter = stage ?? (query.showPassed === false ? { not: "passed" as const } : undefined);

    // Reuses getFocus's own criteria rather than re-deriving them, so
    // "needs attention" can never mean something different here than it
    // does on the Focus tab.
    const focusIds = attentionOnly ? (await this.getFocus(startupId, roundId)).data.map((row) => row.id) : null;

    const where: Prisma.PipelineWhereInput = {
      startupId,
      roundId,
      ...(stageFilter !== undefined && { stage: stageFilter }),
      ...(ownerId && { ownerId }),
      ...(search && {
        startupInvestor: {
          OR: [
            { fullName: { contains: search, mode: "insensitive" as const } },
            { ventureFirm: { contains: search, mode: "insensitive" as const } },
          ],
        },
      }),
      ...(focusIds && { id: { in: focusIds } }),
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
      select: { id: true, stage: true, roundId: true, startupInvestorId: true },
    });
    if (!existing) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");

    if (input.ownerId) await this.verifyMember(startupId, input.ownerId);

    // Neither of these is a column on Pipeline — the reason travels to the
    // stage-history row and the commitment to the round's own table — so both
    // are stripped before the rest of the input reaches Prisma.
    const { reason, commitment, ...fields } = input;

    // Moving a deal between raises. Without it a deal stranded in a round that
    // later closed could only be deleted and rebuilt, which throws away its
    // stage history — and is refused outright once it has tasks.
    const movedToRound =
      input.roundId !== undefined && input.roundId !== existing.roundId ? input.roundId : null;
    // The pipeline row is updated before a new commitment is inserted inside
    // the transaction, so its commitment FK must point at the destination.
    const commitmentRoundId = movedToRound ?? existing.roundId;
    if (movedToRound) {
      await this.verifyRoundAcceptsDeals(startupId, movedToRound);

      // Commitments are keyed to the round the money was pledged to
      // ([pipelineId, startupInvestorId, roundId]), so carrying the deal
      // across would either break that key or silently re-attribute the raise.
      const commitmentCount = await prisma.commitment.count({
        where: { pipelineId, startupId },
      });
      if (commitmentCount > 0) {
        throw createError(
          "This deal has commitments recorded against its round and cannot be moved to another one",
          409,
          "HAS_DEPENDENTS",
        );
      }

      // Land at the bottom of the matching column in the destination, the same
      // way a freshly added card does — its old position means nothing there.
      const bottom = await prisma.pipeline.aggregate({
        where: { startupId, roundId: movedToRound, stage: input.stage ?? existing.stage },
        _max: { sortOrder: true },
      });
      fields.sortOrder = (bottom._max.sortOrder ?? 0) + SORT_ORDER_STEP;
    }

    // Editing an amount is not a stage move; only a real transition advances the
    // clock and appends history.
    const movedTo =
      input.stage !== undefined && input.stage !== existing.stage ? input.stage : null;

    if (movedTo === "passed" && (!reason || reason.trim() === "")) {
      throw createError(
        "A reason is required when marking a deal as passed",
        400,
        "PASSED_REASON_REQUIRED",
      );
    }

    // A deal reaching Committed is the same event as money being committed to
    // the round. Recording only the stage is what let the board and the round
    // page report different numbers for the same investor, so the transition
    // writes both or neither.
    let liveCommitment: { id: string; status: string } | null = null;
    if (movedTo === "committed") {
      liveCommitment = await prisma.commitment.findFirst({
        where: { startupId, pipelineId },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
      });
      if (!liveCommitment && !commitment) {
        throw createError(
          "Commitment details are required when moving a deal to committed",
          400,
          "COMMITMENT_DETAILS_REQUIRED",
        );
      }
    }

    if (movedTo === null) {
      if (movedToRound) {
        const entry = await prisma.$transaction(async (tx) => {
          const updated = await tx.pipeline.update({
            where: { id: pipelineId },
            data: fields,
            select: ENTRY_SELECT,
          });
          // This is a new opportunity in the destination raise, not a stage
          // transition in the old one. It gives the new round a funnel entry
          // while leaving every earlier event attached to the original round.
          await tx.pipelineStageEvent.create({
            data: {
              startupId,
              roundId: movedToRound,
              pipelineId,
              fromStage: null,
              toStage: existing.stage,
              changedBy: userId ?? null,
            },
          });
          return updated;
        }).catch((err) => {
          throw this.translateDuplicatePipeline(err);
        });
        return serializeEntry(entry);
      }
      try {
        const entry = await prisma.pipeline.update({
          where: { id: pipelineId },
          data: fields,
          select: ENTRY_SELECT,
        });
        return serializeEntry(entry);
      } catch (err) {
        // Only reachable on a round move: the investor already holds a deal
        // in the destination round.
        throw this.translateDuplicatePipeline(err);
      }
    }

    const changedAt = new Date();
    const entry = await prisma.$transaction(async (tx) => {
      const updated = await tx.pipeline.update({
        where: { id: pipelineId },
        data: { ...fields, stageChangedAt: changedAt },
        select: ENTRY_SELECT,
      });

      if (movedToRound) {
        await tx.pipelineStageEvent.create({
          data: {
            startupId,
            roundId: movedToRound,
            pipelineId,
            fromStage: null,
            toStage: existing.stage,
            changedBy: userId ?? null,
            createdAt: changedAt,
          },
        });
      }

      await tx.pipelineStageEvent.create({
        data: {
          startupId,
          roundId: commitmentRoundId,
          pipelineId,
          fromStage: existing.stage,
          toStage: movedTo,
          reason: movedTo === "passed" ? (reason as string) : null,
          changedBy: userId ?? null,
          createdAt: changedAt,
        },
      });

      if (movedTo === "committed" && commitment) {
        if (liveCommitment) {
          // A commitment already recorded for this deal — most likely added
          // from the round page, or withdrawn when the deal moved back out
          // and now revived. Update it rather than stacking a second row.
          await tx.commitment.update({
            where: { id: liveCommitment.id },
            data: {
              amount: commitment.amount,
              status: commitment.status ?? "soft_circled",
              ...(commitment.expectedCloseDate !== undefined && {
                expectedCloseDate: commitment.expectedCloseDate,
              }),
            },
          });
        } else {
          await tx.commitment.create({
            data: {
              startupId,
              startupInvestorId: existing.startupInvestorId,
              pipelineId,
              // A commitment blocks a round move, so the deal's round cannot
              // have changed in this same request — existing.roundId is still
              // the round the money is being pledged to.
              roundId: commitmentRoundId,
              amount: commitment.amount,
              status: commitment.status ?? "soft_circled",
              ...(commitment.expectedCloseDate && {
                expectedCloseDate: commitment.expectedCloseDate,
              }),
            },
          });
        }
      }

      // Backing out of Committed retracts the money too, but the row stays —
      // withdrawn is part of the round's history, and deleting it would also
      // strand any amount already wired.
      if (existing.stage === "committed" && movedTo !== "committed") {
        const liveCommitments = await tx.commitment.findMany({
          where: { startupId, pipelineId, status: { not: "withdrawn" } },
          select: { id: true, status: true },
        });
        await tx.commitment.updateMany({
          where: { startupId, pipelineId, status: { not: "withdrawn" } },
          data: { status: "withdrawn" },
        });
        if (liveCommitments.length > 0) {
          await tx.commitmentStatusEvent.createMany({
            data: liveCommitments.map((current) => ({
              startupId,
              commitmentId: current.id,
              fromStatus: current.status,
              toStatus: "withdrawn",
              changedBy: userId ?? null,
            })),
          });
        }
      }

      return updated;
    }).catch((err) => {
      // A round move in the same request as a stage move can still collide
      // with an existing deal for this investor in the destination.
      throw this.translateDuplicatePipeline(err);
    });

    return serializeEntry(entry);
  }

  /**
   * A destination round has to exist in this startup and still be taking
   * deals. Carrying work into a raise that is already closed or cancelled is
   * the same mistake as adding a new deal to one.
   */
  private async verifyRoundAcceptsDeals(startupId: string, roundId: string): Promise<void> {
    const round = await prisma.fundraisingRound.findUnique({
      where: { startupId_id: { startupId, id: roundId } },
      select: { id: true, status: true, roundName: true },
    });
    if (!round) {
      throw createError("Fundraising round not found", 404, "FUNDRAISING_ROUND_NOT_FOUND");
    }
    if (!(OPEN_ROUND_STATUSES as readonly string[]).includes(round.status)) {
      throw createError(
        `${round.roundName} is ${round.status}, so it cannot take new pipeline deals`,
        409,
        "ROUND_NOT_OPEN",
      );
    }
  }

  async deleteEntry(startupId: string, pipelineId: string) {
    const existing = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { id: true },
    });
    if (!existing) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");

    // Phase 5 Commitments FK onto pipeline — guard now so Phase 5 does not retrofit it.
    const [commitmentCount, openTaskCount] = await Promise.all([
      prisma.commitment.count({ where: { pipelineId, startupId } }),
      // Only *unfinished* work blocks: outstanding tasks mean someone still
      // expects to act on this deal. Checking first turns what would be a raw
      // P2003 from the Restrict FK into a clean 409.
      prisma.task.count({ where: { pipelineId, startupId, status: "open" } }),
    ]);
    if (commitmentCount > 0 || openTaskCount > 0) {
      throw createError(
        "This pipeline entry has commitments or open tasks and cannot be deleted",
        409,
        "HAS_DEPENDENTS",
      );
    }

    // Whatever tasks are left are all completed. They belong to the deal being
    // removed, and the Restrict FK means they have to go first — in the same
    // transaction, so a failure never leaves a deal stripped of its tasks.
    await prisma.$transaction(async (tx) => {
      await tx.task.deleteMany({ where: { pipelineId, startupId } });
      await tx.pipeline.delete({ where: { id: pipelineId } });
    });
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
  async getAnalytics(startupId: string, requestedRoundId?: string) {
    const roundId = await this.resolveRoundId(startupId, requestedRoundId);
    const [entries, events] = await Promise.all([
      prisma.pipeline.findMany({
        where: { startupId, roundId },
        select: { id: true, stage: true, expectedAmount: true, stageChangedAt: true },
      }),
      prisma.pipelineStageEvent.findMany({
        where: { startupId, roundId },
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
      select: {
        id: true,
        roundId: true,
        fromStage: true,
        toStage: true,
        reason: true,
        changedBy: true,
        createdAt: true,
      },
    });

    return { data: events };
  }

  /**
   * Deals that need a founder's attention right now, computed entirely
   * server-side: overdue tasks, deals with no open task at all, deals gone
   * quiet with nothing scheduled, and high-priority deals with no other
   * signal. Settled deals (committed/passed) never qualify. Returning only
   * the qualifying rows — pre-sorted by urgency — means the client does no
   * aggregation and never has to page through every interaction log to
   * build this list.
   */
  async getFocus(startupId: string, requestedRoundId?: string) {
    const roundId = await this.resolveRoundId(startupId, requestedRoundId);
    const QUIET_AFTER_DAYS = 14;

    const entries = await prisma.pipeline.findMany({
      where: { startupId, roundId, stage: { notIn: ["committed", "passed"] } },
      select: ENTRY_SELECT,
    });
    if (entries.length === 0) return { data: [] };

    const pipelineIds = entries.map((entry) => entry.id);
    const investorIds = entries.map((entry) => entry.startupInvestorId);

    const [openTasks, lastTouchByInvestor] = await Promise.all([
      prisma.task.findMany({
        where: { startupId, pipelineId: { in: pipelineIds }, status: "open" },
        orderBy: { dueDate: { sort: "asc", nulls: "last" } },
        select: { pipelineId: true, dueDate: true },
      }),
      this.computeLastTouch(investorIds),
    ]);

    // First task per deal in the sorted list is the soonest-due (or
    // earliest-created undated) open task for that deal.
    const soonestTaskByDeal = new Map<string, Date | null>();
    const hasOpenTaskByDeal = new Set<string>();
    for (const task of openTasks) {
      hasOpenTaskByDeal.add(task.pipelineId);
      if (!soonestTaskByDeal.has(task.pipelineId)) {
        soonestTaskByDeal.set(task.pipelineId, task.dueDate);
      }
    }

    const now = Date.now();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    type FocusRow = ReturnType<typeof serializeEntry> & {
      reason: string;
      daysQuiet: number;
      nextTaskDueDate: string | null;
    };
    const rows: FocusRow[] = [];
    const rank: Record<string, number> = { overdue: 0, today: 1, missing: 2, quiet: 3, priority: 4 };

    for (const entry of entries) {
      const hasOpenTask = hasOpenTaskByDeal.has(entry.id);
      const dueDate = soonestTaskByDeal.get(entry.id) ?? null;
      const lastTouch = lastTouchByInvestor.get(entry.startupInvestorId) ?? null;
      const since = lastTouch ?? entry.createdAt.getTime();
      const daysQuiet = Math.max(0, Math.floor((now - since) / (24 * 60 * 60 * 1000)));

      let reason: string | null = null;
      if (dueDate && dueDate.getTime() < now) {
        reason = "overdue";
      } else if (dueDate && dueDate.getTime() <= endOfToday.getTime()) {
        reason = "today";
      } else if (!hasOpenTask) {
        reason = "missing";
      } else if (daysQuiet >= QUIET_AFTER_DAYS) {
        reason = "quiet";
      } else if (entry.priority === "high") {
        reason = "priority";
      }

      if (reason === null) continue;

      rows.push({
        ...serializeEntry(entry),
        reason,
        daysQuiet,
        nextTaskDueDate: dueDate ? dueDate.toISOString() : null,
      });
    }

    rows.sort((a, b) => {
      const byUrgency = rank[a.reason] - rank[b.reason];
      if (byUrgency !== 0) return byUrgency;
      return b.daysQuiet - a.daysQuiet;
    });

    return { data: rows };
  }

  /**
   * Most recent contact per investor, as two aggregates rather than a scan of
   * every log the startup has ever written.
   *
   * Deliberately relationship-level, not round-level: this feeds the "gone
   * quiet" signal, and the question that answers is whether anyone has spoken
   * to this person lately. If you called them last week about the Seed, they
   * are not someone you have gone quiet on, whichever round the card sits in.
   * Scoping it per deal would also read as "never contacted" for most deals,
   * since a log made from the Investors page carries no pipelineId at all.
   * The deal sheet marks cross-deal logs in its timeline instead, which is
   * where the distinction actually matters.
   *
   * "Last touch" is the newest interactionDate, falling back to when the log
   * was written for the ones that never got a date — two cases a single
   * groupBy cannot express, because there is nothing to aggregate over but
   * the raw column and Prisma has no COALESCE.
   *
   * Ordering a findMany by the nullable interactionDate instead would be
   * wrong as well as unbounded: Postgres sorts DESC as NULLS FIRST, so a
   * single undated log outranks every dated one and pins that investor's
   * last touch to whenever the undated row happened to be created.
   */
  private async computeLastTouch(investorIds: string[]): Promise<Map<string, number>> {
    if (investorIds.length === 0) return new Map();

    const [dated, undated] = await Promise.all([
      prisma.interactionLog.groupBy({
        by: ["startupInvestorId"],
        where: { startupInvestorId: { in: investorIds }, interactionDate: { not: null } },
        _max: { interactionDate: true },
      }),
      prisma.interactionLog.groupBy({
        by: ["startupInvestorId"],
        where: { startupInvestorId: { in: investorIds }, interactionDate: null },
        _max: { createdAt: true },
      }),
    ]);

    const lastTouch = new Map<string, number>();
    for (const row of dated) {
      const at = row._max.interactionDate;
      if (at) lastTouch.set(row.startupInvestorId, at.getTime());
    }
    for (const row of undated) {
      const at = row._max.createdAt;
      if (!at) continue;
      const existing = lastTouch.get(row.startupInvestorId);
      if (existing === undefined || at.getTime() > existing) {
        lastTouch.set(row.startupInvestorId, at.getTime());
      }
    }
    return lastTouch;
  }

  private async verifyMember(startupId: string, memberId: string): Promise<void> {
    const member = await prisma.startupMember.findUnique({
      where: { startupId_id: { startupId, id: memberId } },
      select: { id: true },
    });
    if (!member) throw createError("Owner is not a member of this startup", 404, "MEMBER_NOT_FOUND");
  }

  private translateDuplicatePipeline(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return createError(
        "This investor already has a pipeline entry for this fundraising round",
        409,
        "ALREADY_IN_PIPELINE",
      );
    }
    return err;
  }

  /**
   * Pre-round clients did not send a round id. Retain that path only when it
   * is unambiguous: exactly one active round. Picking an arbitrary active
   * round would silently put outreach into the wrong raise.
   */
  private async resolveRoundId(
    startupId: string,
    requestedRoundId?: string,
    options: { forNewDeal?: boolean } = {},
  ): Promise<string> {
    if (requestedRoundId) {
      if (options.forNewDeal) {
        await this.verifyRoundAcceptsDeals(startupId, requestedRoundId);
        return requestedRoundId;
      }
      // Reads must keep working for a finished raise — that is where its
      // history lives.
      const round = await prisma.fundraisingRound.findUnique({
        where: { startupId_id: { startupId, id: requestedRoundId } },
        select: { id: true },
      });
      if (!round) {
        throw createError("Fundraising round not found", 404, "FUNDRAISING_ROUND_NOT_FOUND");
      }
      return round.id;
    }

    const activeRounds = await prisma.fundraisingRound.findMany({
      where: { startupId, status: "active" },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { id: true },
    });
    if (activeRounds.length === 1) return activeRounds[0].id;

    throw createError(
      "Specify roundId because this startup does not have exactly one active fundraising round",
      409,
      "FUNDRAISING_ROUND_REQUIRED",
    );
  }
}

export const pipelineService = new PipelineService();
