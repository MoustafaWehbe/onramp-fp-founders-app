import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
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