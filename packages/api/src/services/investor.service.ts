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
  notesCreatedAt: true,
  notesCreatedBy: true,
  notesUpdatedAt: true,
  notesUpdatedBy: true,
  source: true,
  description: true,
  checkSizeMin: true,
  checkSizeMax: true,
  geographyFocus: true,
  portfolioHighlights: true,
  warmIntroPath: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PIPELINE_SELECT = {
  id: true,
  // A contact's expectedAmount is only meaningful in the currency of the
  // round it belongs to the client needs roundId to look that up.
  roundId: true,
  stage: true,
  expectedAmount: true,
  probabilityPercentage: true,
} as const;

type PipelineRow = {
  id: string;
  roundId: string;
  stage: string;
  expectedAmount: Prisma.Decimal | null;
  probabilityPercentage: number | null;
};

/**
 * "Engaged" means this startup has actually approached the contact: they are
 * on the pipeline board, or someone has logged a call/email/meeting with them.
 * Everything else is a prospect sourced or imported, never reached out to.
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

/** "a", "a and b", "a, b and c" for naming what blocks a delete. */
function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

type ContactRow = { checkSizeMin: Prisma.Decimal | null; checkSizeMax: Prisma.Decimal | null } & Record<string, unknown>;

// Decimal serializes to a JSON string, but the API contract documents these as
// numbers convert at the boundary rather than leaking Prisma's type.
function serializeContact<T extends ContactRow>(contact: T) {
  return { ...contact, checkSizeMin: contact.checkSizeMin === null ? null : Number(contact.checkSizeMin), checkSizeMax: contact.checkSizeMax === null ? null : Number(contact.checkSizeMax) };
}

// Decimal serializes to a JSON string, but the API contract documents these as
// numbers convert at the boundary rather than leaking Prisma's type.
function serializePipeline(entry: PipelineRow | undefined) {
  if (!entry) return null;
  return {
    id: entry.id,
    roundId: entry.roundId,
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
      return serializeContact(await prisma.startupInvestor.create({
        data: { startupId, ...input },
        select: CONTACT_SELECT,
      }));
    } catch (err) {
      // Narrows the race between the check above and this insert.
      throw this.translateDuplicateEmail(err);
    }
  }

  async listInvestors(startupId: string, query: ListInvestorsQuery) {
    const { page, limit, search, investorType, stage, engagement, roundId } = query;

    // Everything except the engagement split. The tab counts are taken against
    // this so they answer "how many match my search on the other tab", rather
    // than always reporting the whole directory.
    const baseWhere: Prisma.StartupInvestorWhereInput = {
      startupId,
      ...(investorType && { investorType }),
      ...(stage && { pipeline: { some: { stage, ...(roundId && { roundId }) } } }),
      ...(search && {
        OR: [
          // Matched token-by-token (every word in the search must appear
          // somewhere in the name, in any order) rather than as one contiguous
          // substring a name typed slightly wrong, e.g. "Sara Chen" instead of
          // "Sarah Chen", is otherwise a contiguous-substring miss even though
          // every word the caller typed is genuinely present in the name.
          { AND: search.trim().split(/\s+/).filter(Boolean).map((token) => ({ fullName: { contains: token, mode: "insensitive" as const } })) },
          { email: { contains: search, mode: "insensitive" as const } },
          { ventureFirm: { contains: search, mode: "insensitive" as const } },
          { sectorFocus: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
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
          // At most one entry exists per contact the schema enforces
          // @@unique([startupId, startupInvestorId]).
          pipeline: {
            ...(roundId && { where: { roundId } }),
            select: PIPELINE_SELECT,
            take: 1,
          },
        },
      }),
    ]);

    // The two counts partition the same base set, so the total for whichever
    // view is being asked for falls out of them no third count query.
    const total =
      engagement === "engaged"
        ? engagedCount
        : engagement === "prospect"
          ? prospectCount
          : engagedCount + prospectCount;

    const contactIds = contacts.map((c) => c.id);
    const [followups, lastInteractions] = await Promise.all([
      this.nextFollowupsFor(contactIds),
      this.lastInteractionsFor(contactIds),
    ]);

    return {
      data: contacts.map(({ pipeline, ...contact }) => ({
        ...serializeContact(contact),
        pipeline: serializePipeline(pipeline[0]),
        nextFollowupDate: followups.get(contact.id) ?? null,
        lastInteractionDate: lastInteractions.get(contact.id) ?? null,
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

    const [followups, lastInteractions] = await Promise.all([
      this.nextFollowupsFor([contact.id]),
      this.lastInteractionsFor([contact.id]),
    ]);
    const { pipeline, ...rest } = contact;

    return {
      ...serializeContact(rest),
      pipeline: serializePipeline(pipeline[0]),
      nextFollowupDate: followups.get(contact.id) ?? null,
      lastInteractionDate: lastInteractions.get(contact.id) ?? null,
    };
  }

  async updateInvestor(
    startupId: string,
    investorId: string,
    input: UpdateInvestorInput,
    userId?: string,
  ) {
    const existing = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: investorId } },
      select: { id: true, email: true, notes: true, notesCreatedAt: true },
    });
    if (!existing) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");

    if (input.email && input.email !== existing.email) {
      await this.assertEmailAvailable(startupId, input.email, investorId);
    }

    try {
      return serializeContact(await prisma.startupInvestor.update({
        where: { id: investorId },
        data: { ...input, ...this.noteAuthorship(input, existing, userId) },
        select: CONTACT_SELECT,
      }));
    } catch (err) {
      throw this.translateDuplicateEmail(err);
    }
  }

  /**
   * Note authorship is derived here rather than trusted from the client, the
   * same way completedAt is on tasks. Writing the first note records an
   * author; every later change records an editor; clearing the note clears
   * both, so a fresh note never inherits the previous one's byline. An
   * identical resubmission is not an edit and leaves the timestamps alone.
   */
  private noteAuthorship(
    input: UpdateInvestorInput,
    existing: { notes: string | null; notesCreatedAt: Date | null },
    userId?: string,
  ): Prisma.StartupInvestorUncheckedUpdateInput {
    if (input.notes === undefined) return {};

    if (input.notes === null) {
      return {
        notesCreatedAt: null,
        notesCreatedBy: null,
        notesUpdatedAt: null,
        notesUpdatedBy: null,
      };
    }

    if (input.notes === existing.notes) return {};

    const now = new Date();
    const isFirstNote = !existing.notes || existing.notesCreatedAt === null;

    return {
      ...(isFirstNote && { notesCreatedAt: now, notesCreatedBy: userId ?? null }),
      notesUpdatedAt: now,
      notesUpdatedBy: userId ?? null,
    };
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

  /**
   * When each contact was last actually spoken to the newest interactionDate,
   * falling back to when the log was written for entries that never got one.
   * Two grouped queries rather than one because there is no COALESCE to
   * aggregate over, and ordering by the nullable column directly would sort
   * NULLS FIRST on Postgres and let an undated log win.
   */
  private async lastInteractionsFor(contactIds: string[]): Promise<Map<string, Date>> {
    if (contactIds.length === 0) return new Map();

    const [dated, undated] = await Promise.all([
      prisma.interactionLog.groupBy({
        by: ["startupInvestorId"],
        where: { startupInvestorId: { in: contactIds }, interactionDate: { not: null } },
        _max: { interactionDate: true },
      }),
      prisma.interactionLog.groupBy({
        by: ["startupInvestorId"],
        where: { startupInvestorId: { in: contactIds }, interactionDate: null },
        _max: { createdAt: true },
      }),
    ]);

    const lastTouch = new Map<string, Date>();
    for (const row of dated) {
      if (row._max.interactionDate) lastTouch.set(row.startupInvestorId, row._max.interactionDate);
    }
    for (const row of undated) {
      const at = row._max.createdAt;
      if (!at) continue;
      const existing = lastTouch.get(row.startupInvestorId);
      if (!existing || at > existing) lastTouch.set(row.startupInvestorId, at);
    }
    return lastTouch;
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
