import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
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
  createdAt: true,
  updatedAt: true,
  startupInvestor: { select: CONTACT_SELECT },
} as const;

type EntryRow = {
  id: string;
  startupId: string;
  startupInvestorId: string;
  stage: string;
  expectedAmount: Prisma.Decimal | null;
  probabilityPercentage: number | null;
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
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export class PipelineService {
  async createEntry(startupId: string, input: CreatePipelineEntryInput) {
    const contact = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: input.investorId } },
      select: { id: true },
    });
    if (!contact) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");

    try {
      const entry = await prisma.pipeline.create({
        data: {
          startupId,
          startupInvestorId: input.investorId,
          stage: input.stage,
          ...(input.expectedAmount !== undefined && { expectedAmount: input.expectedAmount }),
          ...(input.probabilityPercentage !== undefined && {
            probabilityPercentage: input.probabilityPercentage,
          }),
        },
        select: ENTRY_SELECT,
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
        orderBy: { updatedAt: "desc" },
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

  async updateEntry(startupId: string, pipelineId: string, input: UpdatePipelineEntryInput) {
    const existing = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { id: true },
    });
    if (!existing) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");

    const entry = await prisma.pipeline.update({
      where: { id: pipelineId },
      data: input,
      select: ENTRY_SELECT,
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
