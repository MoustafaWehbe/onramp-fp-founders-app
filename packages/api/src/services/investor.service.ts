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

/**
 * "Engaged" means this startup has actually approached the contact: they are
 * on the pipeline board, or someone has logged a call/email/meeting with them.
 * Everything else is a prospect — sourced or imported, never reached out to.
 * Derived rather than stored, so it cannot drift from what the team has done.
 */
const ENGAGEMENT_FILTERS = {
  engaged: {
    OR: [{ pipeline: { some: {} } }, { interactionLogs: { some: {} } }],
  },
  prospect: {
    pipeline: { none: {} },
    interactionLogs: { none: {} },
  },
} as const satisfies Record<string, Prisma.StartupInvestorWhereInput>;

/** "a", "a and b", "a, b and c" — for naming what blocks a delete. */
function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

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
    const { page, limit, search, investorType, stage, engagement } = query;

    // Everything except the engagement split. The tab counts are taken against
    // this so they answer "how many match my search on the other tab", rather
    // than always reporting the whole directory.
    const baseWhere: Prisma.StartupInvestorWhereInput = {
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

    // Combined with AND rather than spread: both sides use `OR` (search vs.
    // engaged) and `pipeline` (stage vs. prospect), so merging them as keys
    // would silently drop one of the two filters.
    const where: Prisma.StartupInvestorWhereInput = engagement
      ? { AND: [baseWhere, ENGAGEMENT_FILTERS[engagement]] }
      : baseWhere;

    const [engagedCount, prospectCount, contacts] = await Promise.all([
      prisma.startupInvestor.count({
        where: { AND: [baseWhere, ENGAGEMENT_FILTERS.engaged] },
      }),
      prisma.startupInvestor.count({
        where: { AND: [baseWhere, ENGAGEMENT_FILTERS.prospect] },
      }),
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

    // The two counts partition the same base set, so the total for whichever
    // view is being asked for falls out of them — no third count query.
    const total =
      engagement === "engaged"
        ? engagedCount
        : engagement === "prospect"
          ? prospectCount
          : engagedCount + prospectCount;

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
        engagementCounts: { engaged: engagedCount, prospect: prospectCount },
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

    // Every FK onto startup_investors cascades on delete, so without this guard
    // removing a contact would silently destroy its pipeline entry, commitments
    // and logged history rather than failing.
    const [pipelineCount, commitmentCount, interactionLogCount] = await Promise.all([
      prisma.pipeline.count({ where: { startupInvestorId: investorId } }),
      prisma.commitment.count({ where: { startupInvestorId: investorId } }),
      prisma.interactionLog.count({ where: { startupInvestorId: investorId } }),
    ]);

    const blockers = [
      pipelineCount > 0 ? "pipeline entries" : null,
      commitmentCount > 0 ? "commitments" : null,
      interactionLogCount > 0 ? "interaction logs" : null,
    ].filter((value): value is string => value !== null);

    if (blockers.length > 0) {
      throw createError(
        `This contact has ${listPhrase(blockers)} and cannot be deleted`,
        409,
        "HAS_DEPENDENTS",
      );
    }

    await prisma.startupInvestor.delete({ where: { id: investorId } });
  }

  /**
   * Earliest open follow-up per contact, in one grouped query so the list
   * endpoint does not fan out per row. This intentionally includes overdue
   * dates: an overdue next step is more important than a later upcoming one.
   */
  private async nextFollowupsFor(contactIds: string[]): Promise<Map<string, Date | null>> {
    if (contactIds.length === 0) return new Map();

    const grouped = await prisma.interactionLog.groupBy({
      by: ["startupInvestorId"],
      where: {
        startupInvestorId: { in: contactIds },
        nextFollowupDate: { not: null },
        followupCompletedAt: null,
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
