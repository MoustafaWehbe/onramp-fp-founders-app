import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { notificationService } from "./notification.service";
import type {
  CreateInteractionLogInput,
  UpdateInteractionLogInput,
  ListInteractionLogQuery,
} from "../validators/interaction-log.schemas";

const LOG_SELECT = {
  id: true,
  startupInvestorId: true,
  pipelineId: true,
  createdBy: true,
  type: true,
  subject: true,
  description: true,
  interactionDate: true,
  nextFollowupDate: true,
  followupCompletedAt: true,
  createdAt: true,
} as const;

type LogRow = {
  id: string;
  startupInvestorId: string;
  pipelineId: string | null;
  createdBy: string;
  type: string;
  subject: string | null;
  description: string | null;
  interactionDate: Date | null;
  nextFollowupDate: Date | null;
  followupCompletedAt: Date | null;
  createdAt: Date;
};

function serializeLog(row: LogRow) {
  return {
    id: row.id,
    investorId: row.startupInvestorId,
    pipelineId: row.pipelineId,
    createdBy: row.createdBy,
    type: row.type,
    subject: row.subject,
    description: row.description,
    interactionDate: row.interactionDate,
    nextFollowupDate: row.nextFollowupDate,
    followupCompletedAt: row.followupCompletedAt,
    createdAt: row.createdAt,
  };
}

export class InteractionLogService {
  /**
   * Resolve a contact through the startup-scoped composite key.
   * Returns the contact's id or throws INVESTOR_NOT_FOUND.
   */
  private async resolveContact(startupId: string, investorId: string): Promise<string> {
    const contact = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: investorId } },
      select: { id: true },
    });
    if (!contact) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");
    return contact.id;
  }

  /**
   * Verify that a pipeline entry belongs to the same startup and contact.
   * Throws 422 if the pipeline entry does not match the contact.
   */
  private async verifyPipelineBelongsToContact(
    startupId: string,
    pipelineId: string,
    startupInvestorId: string,
  ): Promise<void> {
    const pipeline = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { startupInvestorId: true },
    });
    if (!pipeline || pipeline.startupInvestorId !== startupInvestorId) {
      throw createError(
        "Pipeline entry does not belong to this investor contact",
        422,
        "PIPELINE_MISMATCH",
      );
    }
  }

  /**
   * Recording an interaction is how a follow-up actually gets done — founders
   * log the call, they don't tick a box. So a new log closes that contact's
   * outstanding follow-ups that were due on or before it.
   *
   * Later follow-ups survive: a note logged today must not clear a reminder
   * you deliberately set for next month. The new log is excluded so a log that
   * sets a backdated follow-up doesn't immediately close its own.
   */
  private async completeFollowupsSatisfiedBy(
    startupInvestorId: string,
    newLogId: string,
    interactionDate: Date | null,
  ): Promise<number> {
    const satisfiedThrough = interactionDate ?? new Date();

    const toClose = await prisma.interactionLog.findMany({
      where: {
        startupInvestorId,
        id: { not: newLogId },
        followupCompletedAt: null,
        nextFollowupDate: { not: null, lte: satisfiedThrough },
      },
      select: { id: true },
    });
    if (toClose.length === 0) return 0;

    const closedIds = toClose.map((log) => log.id);
    await prisma.interactionLog.updateMany({
      where: { id: { in: closedIds } },
      data: { followupCompletedAt: satisfiedThrough },
    });

    // Best-effort: an overdue-follow-up notification for one of these would
    // now point at a follow-up that is already done, so it has to go — but
    // losing it must not fail the log that just satisfied it.
    void notificationService.clearFollowupNotifications(closedIds);

    return closedIds.length;
  }

  async createLog(startupId: string, input: CreateInteractionLogInput, userId: string) {
    const contactId = await this.resolveContact(startupId, input.investorId);

    if (input.pipelineId) {
      await this.verifyPipelineBelongsToContact(startupId, input.pipelineId, contactId);
    }

    try {
      const log = await prisma.interactionLog.create({
        data: {
          startupInvestorId: contactId,
          ...(input.pipelineId && { pipelineId: input.pipelineId }),
          createdBy: userId,
          type: input.type,
          subject: input.subject ?? null,
          description: input.description ?? null,
          interactionDate: input.interactionDate,
          nextFollowupDate: input.nextFollowupDate ?? null,
        },
        select: LOG_SELECT,
      });

      await this.completeFollowupsSatisfiedBy(contactId, log.id, log.interactionDate);

      return { data: serializeLog(log) };
    } catch (err) {
      // The composite FK ( [pipelineId, startupInvestorId] ) enforces pipeline-contact
      // consistency at the DB level — translate a violation into a clean 422.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw createError(
          "Pipeline entry does not belong to this investor contact",
          422,
          "PIPELINE_MISMATCH",
        );
      }
      throw err;
    }
  }

  async listLogs(startupId: string, query: ListInteractionLogQuery) {
    const { page, limit } = query;

    // InteractionLog has no startupId — scope through the startup's contacts.
    const where: Prisma.InteractionLogWhereInput = {
      startupInvestor: { startupId },
    };

    const [total, rows] = await Promise.all([
      prisma.interactionLog.count({ where }),
      prisma.interactionLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: LOG_SELECT,
      }),
    ]);

    return {
      data: rows.map(serializeLog),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getLog(startupId: string, logId: string) {
    // Find the log, then verify its contact belongs to the startup.
    const log = await prisma.interactionLog.findUnique({
      where: { id: logId },
      select: { ...LOG_SELECT, startupInvestor: { select: { startupId: true } } },
    });

    if (!log || log.startupInvestor.startupId !== startupId) {
      throw createError("Interaction log not found", 404, "LOG_NOT_FOUND");
    }

    const { startupInvestor, ...rest } = log;
    return { data: serializeLog(rest) };
  }

  async updateLog(startupId: string, logId: string, input: UpdateInteractionLogInput) {
    // Verify the log belongs to the startup through its contact.
    const existing = await prisma.interactionLog.findUnique({
      where: { id: logId },
      select: {
        id: true,
        startupInvestorId: true,
        startupInvestor: { select: { startupId: true } },
      },
    });

    if (!existing || existing.startupInvestor.startupId !== startupId) {
      throw createError("Interaction log not found", 404, "LOG_NOT_FOUND");
    }

    // If pipelineId is being updated, verify it belongs to the same contact.
    if (input.pipelineId !== undefined && input.pipelineId !== null) {
      await this.verifyPipelineBelongsToContact(
        startupId,
        input.pipelineId,
        existing.startupInvestorId,
      );
    }

    try {
      const log = await prisma.interactionLog.update({
        where: { id: logId },
        data: {
          ...(input.pipelineId !== undefined && { pipelineId: input.pipelineId }),
          ...(input.type && { type: input.type }),
          ...(input.interactionDate !== undefined && { interactionDate: input.interactionDate }),
          ...(input.subject !== undefined && { subject: input.subject }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.nextFollowupDate !== undefined && {
            nextFollowupDate: input.nextFollowupDate,
            // Rescheduling reopens the follow-up: the new date is the live one,
            // so a stale completion must not keep it hidden.
            ...(input.followupCompletedAt === undefined && { followupCompletedAt: null }),
          }),
          ...(input.followupCompletedAt !== undefined && {
            followupCompletedAt: input.followupCompletedAt,
          }),
        },
        select: LOG_SELECT,
      });
      return { data: serializeLog(log) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw createError(
          "Pipeline entry does not belong to this investor contact",
          422,
          "PIPELINE_MISMATCH",
        );
      }
      throw err;
    }
  }

  async deleteLog(startupId: string, logId: string) {
    const existing = await prisma.interactionLog.findUnique({
      where: { id: logId },
      select: {
        id: true,
        startupInvestor: { select: { startupId: true } },
      },
    });

    if (!existing || existing.startupInvestor.startupId !== startupId) {
      throw createError("Interaction log not found", 404, "LOG_NOT_FOUND");
    }

    await prisma.interactionLog.delete({ where: { id: logId } });
  }

  async listLogsByInvestor(
    startupId: string,
    investorId: string,
    query: ListInteractionLogQuery,
  ) {
    const contactId = await this.resolveContact(startupId, investorId);
    const { page, limit } = query;

    const where: Prisma.InteractionLogWhereInput = {
      startupInvestorId: contactId,
    };

    const [total, rows] = await Promise.all([
      prisma.interactionLog.count({ where }),
      prisma.interactionLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: LOG_SELECT,
      }),
    ]);

    return {
      data: rows.map(serializeLog),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async listLogsByPipeline(
    startupId: string,
    pipelineId: string,
    query: ListInteractionLogQuery,
  ) {
    // Resolve the pipeline through the startup-scoped composite key.
    const pipeline = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { id: true, startupInvestorId: true },
    });
    if (!pipeline) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");

    const { page, limit } = query;

    const where: Prisma.InteractionLogWhereInput = {
      pipelineId: pipeline.id,
      startupInvestorId: pipeline.startupInvestorId,
    };

    const [total, rows] = await Promise.all([
      prisma.interactionLog.count({ where }),
      prisma.interactionLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: LOG_SELECT,
      }),
    ]);

    return {
      data: rows.map(serializeLog),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const interactionLogService = new InteractionLogService();