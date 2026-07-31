import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import type {
  CreateInvestorInput,
  UpdateInvestorInput,
  ListInvestorsQuery,
} from "../validators/investor.schemas";

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

const PIPELINE_SELECT = {
  id: true,
  stage: true,
  expectedAmount: true,
  probabilityPercentage: true,
} as const;

type PipelineRow = {
  id: string;
  stage: string;
  expectedAmount: Prisma.Decimal | null;
  probabilityPercentage: number | null;
};

// Decimal serializes to a JSON string, but the API contract documents these as
// numbers — convert at the boundary rather than leaking Prisma's type.
function serializePipeline(entry: PipelineRow | undefined) {
  if (!entry) return null;
  return {
    id: entry.id,
    stage: entry.stage,
    expectedAmount: entry.expectedAmount === null ? null : Number(entry.expectedAmount),
    probabilityPercentage: entry.probabilityPercentage,
  };
}

export class InvestorService {
  async createInvestor(startupId: string, input: CreateInvestorInput) {
    if (input.email) {
      await this.assertEmailAvailable(startupId, input.email);
    }

    try {
      return await prisma.startupInvestor.create({
        data: { startupId, ...input },
        select: CONTACT_SELECT,
      });
    } catch (err) {
      // Narrows the race between the check above and this insert.
      throw this.translateDuplicateEmail(err);
    }
  }

  async listInvestors(startupId: string, query: ListInvestorsQuery) {
    const { page, limit, search, investorType, stage } = query;

    const where: Prisma.StartupInvestorWhereInput = {
      startupId,
      ...(investorType && { investorType }),
      ...(stage && { pipeline: { some: { stage } } }),
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { ventureFirm: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [total, contacts] = await Promise.all([
      prisma.startupInvestor.count({ where }),
      prisma.startupInvestor.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          ...CONTACT_SELECT,
          // At most one entry exists per contact — the schema enforces
          // @@unique([startupId, startupInvestorId]).
          pipeline: { select: PIPELINE_SELECT, take: 1 },
        },
      }),
    ]);

    const followups = await this.nextFollowupsFor(contacts.map((c) => c.id));

    return {
      data: contacts.map(({ pipeline, ...contact }) => ({
        ...contact,
        pipeline: serializePipeline(pipeline[0]),
        nextFollowupDate: followups.get(contact.id) ?? null,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getInvestor(startupId: string, investorId: string) {
    const contact = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: investorId } },
      select: {
        ...CONTACT_SELECT,
        pipeline: { select: PIPELINE_SELECT, take: 1 },
      },
    });

    if (!contact) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");

    const followups = await this.nextFollowupsFor([contact.id]);
    const { pipeline, ...rest } = contact;

    return {
      ...rest,
      pipeline: serializePipeline(pipeline[0]),
      nextFollowupDate: followups.get(contact.id) ?? null,
    };
  }

  async updateInvestor(startupId: string, investorId: string, input: UpdateInvestorInput) {
    const existing = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: investorId } },
      select: { id: true, email: true },
    });
    if (!existing) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");

    if (input.email && input.email !== existing.email) {
      await this.assertEmailAvailable(startupId, input.email, investorId);
    }

    try {
      return await prisma.startupInvestor.update({
        where: { id: investorId },
        data: input,
        select: CONTACT_SELECT,
      });
    } catch (err) {
      throw this.translateDuplicateEmail(err);
    }
  }

  async deleteInvestor(startupId: string, investorId: string) {
    const existing = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: investorId } },
      select: { id: true },
    });
    if (!existing) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");

    // Checked explicitly so the caller gets a 409 rather than a raw FK error.
    const [pipelineCount, commitmentCount] = await Promise.all([
      prisma.pipeline.count({ where: { startupInvestorId: investorId } }),
      prisma.commitment.count({ where: { startupInvestorId: investorId } }),
    ]);

    if (pipelineCount > 0 || commitmentCount > 0) {
      throw createError(
        "This contact has pipeline entries or commitments and cannot be deleted",
        409,
        "HAS_DEPENDENTS",
      );
    }

    await prisma.startupInvestor.delete({ where: { id: investorId } });
  }

  /**
   * Earliest upcoming follow-up per contact, in one grouped query so the list
   * endpoint does not fan out per row.
   */
  private async nextFollowupsFor(contactIds: string[]): Promise<Map<string, Date | null>> {
    if (contactIds.length === 0) return new Map();

    const grouped = await prisma.interactionLog.groupBy({
      by: ["startupInvestorId"],
      where: {
        startupInvestorId: { in: contactIds },
        nextFollowupDate: { gt: new Date() },
      },
      _min: { nextFollowupDate: true },
    });

    return new Map(grouped.map((row) => [row.startupInvestorId, row._min.nextFollowupDate]));
  }

  private async assertEmailAvailable(startupId: string, email: string, excludeId?: string) {
    const clash = await prisma.startupInvestor.findUnique({
      where: { startupId_email: { startupId, email } },
      select: { id: true },
    });

    if (clash && clash.id !== excludeId) {
      throw createError(
        "This startup already has a contact with that email",
        409,
        "DUPLICATE_EMAIL",
      );
    }
  }

  private translateDuplicateEmail(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return createError(
        "This startup already has a contact with that email",
        409,
        "DUPLICATE_EMAIL",
      );
    }
    return err;
  }
}

export const investorService = new InvestorService();
