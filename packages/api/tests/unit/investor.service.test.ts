import { Prisma } from "@prisma/client";
import { InvestorService } from "../../src/services/investor.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupInvestor: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pipeline: { count: jest.fn() },
    commitment: { count: jest.fn() },
    interactionLog: { groupBy: jest.fn(), count: jest.fn() },
  },
}));

import { prisma } from "../../src/db/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new InvestorService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const CONTACT_ID = "00000000-0000-0000-0000-000000000002";
const OTHER_ID = "00000000-0000-0000-0000-000000000003";

const DEFAULT_QUERY = { page: 1, limit: 20 };

/** findUnique is called with either the startupId_email or startupId_id key. */
function mockFindUnique(handlers: { byEmail?: unknown; byId?: unknown }) {
  (mockPrisma.startupInvestor.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
    if (where.startupId_email) return Promise.resolve(handlers.byEmail ?? null);
    return Promise.resolve(handlers.byId ?? null);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.interactionLog.groupBy as jest.Mock).mockResolvedValue([]);
});

describe("InvestorService.createInvestor", () => {
  it("creates a contact scoped to the startup", async () => {
    mockFindUnique({ byEmail: null });
    (mockPrisma.startupInvestor.create as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

    await service.createInvestor(STARTUP_ID, {
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    } as never);

    expect(mockPrisma.startupInvestor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startupId: STARTUP_ID,
          fullName: "Ada Lovelace",
          email: "ada@example.com",
        }),
      }),
    );
  });

  it("throws DUPLICATE_EMAIL when the startup already has that email", async () => {
    mockFindUnique({ byEmail: { id: OTHER_ID } });

    await expect(
      service.createInvestor(STARTUP_ID, {
        fullName: "Ada Twin",
        email: "ada@example.com",
      } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_EMAIL" });

    expect(mockPrisma.startupInvestor.create).not.toHaveBeenCalled();
  });

  it("skips the uniqueness check when no email is given", async () => {
    (mockPrisma.startupInvestor.create as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

    await service.createInvestor(STARTUP_ID, { fullName: "Anonymous Angel" } as never);

    expect(mockPrisma.startupInvestor.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.startupInvestor.create).toHaveBeenCalled();
  });

  it("translates a P2002 race into DUPLICATE_EMAIL", async () => {
    mockFindUnique({ byEmail: null });
    (mockPrisma.startupInvestor.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );

    await expect(
      service.createInvestor(STARTUP_ID, {
        fullName: "Ada",
        email: "ada@example.com",
      } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_EMAIL" });
  });

  it("rethrows unrelated database errors untouched", async () => {
    mockFindUnique({ byEmail: null });
    (mockPrisma.startupInvestor.create as jest.Mock).mockRejectedValue(new Error("connection lost"));

    await expect(
      service.createInvestor(STARTUP_ID, { fullName: "Ada" } as never),
    ).rejects.toThrow("connection lost");
  });
});

describe("InvestorService.listInvestors", () => {
  /** The two counts resolve in order: engaged first, then prospect. */
  function mockCounts(engaged: number, prospect: number) {
    (mockPrisma.startupInvestor.count as jest.Mock)
      .mockResolvedValueOnce(engaged)
      .mockResolvedValueOnce(prospect);
  }

  it("returns pagination meta alongside the rows", async () => {
    mockCounts(12, 33);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listInvestors(STARTUP_ID, { page: 2, limit: 20 } as never);

    // With no engagement filter the view spans both tabs, so total is the sum.
    expect(result.meta).toEqual({
      page: 2,
      limit: 20,
      total: 45,
      totalPages: 3,
      engagementCounts: { engaged: 12, prospect: 33 },
    });
    expect(mockPrisma.startupInvestor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });

  it("treats a contact as engaged when it is in the pipeline or has logged interactions", async () => {
    mockCounts(4, 9);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listInvestors(STARTUP_ID, {
      ...DEFAULT_QUERY,
      engagement: "engaged",
    } as never);

    const { where } = (mockPrisma.startupInvestor.findMany as jest.Mock).mock.calls[0][0];
    expect(where.AND[1]).toEqual({
      OR: [{ pipeline: { some: {} } }, { interactionLogs: { some: {} } }],
    });
    // Total narrows to the tab being viewed; the counts still describe both.
    expect(result.meta.total).toBe(4);
    expect(result.meta.engagementCounts).toEqual({ engaged: 4, prospect: 9 });
  });

  it("treats a contact as a prospect only when it has neither", async () => {
    mockCounts(4, 9);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listInvestors(STARTUP_ID, {
      ...DEFAULT_QUERY,
      engagement: "prospect",
    } as never);

    const { where } = (mockPrisma.startupInvestor.findMany as jest.Mock).mock.calls[0][0];
    expect(where.AND[1]).toEqual({
      pipeline: { none: {} },
      interactionLogs: { none: {} },
    });
    expect(result.meta.total).toBe(9);
  });

  it("keeps the search filter when an engagement tab is selected", async () => {
    // Both halves use `OR`, so merging them as plain keys would drop the
    // search entirely and quietly return the whole tab.
    mockCounts(1, 1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    await service.listInvestors(STARTUP_ID, {
      ...DEFAULT_QUERY,
      search: "accel",
      engagement: "engaged",
    } as never);

    const { where } = (mockPrisma.startupInvestor.findMany as jest.Mock).mock.calls[0][0];
    expect(where.AND[0].OR).toEqual([
      { fullName: { contains: "accel", mode: "insensitive" } },
      { email: { contains: "accel", mode: "insensitive" } },
      { ventureFirm: { contains: "accel", mode: "insensitive" } },
    ]);
    expect(where.AND[1].OR).toEqual([
      { pipeline: { some: {} } },
      { interactionLogs: { some: {} } },
    ]);
  });

  it("keeps the stage filter when an engagement tab is selected", async () => {
    // Both halves constrain `pipeline`, the other collision case.
    mockCounts(1, 1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    await service.listInvestors(STARTUP_ID, {
      ...DEFAULT_QUERY,
      stage: "term_sheet",
      engagement: "engaged",
    } as never);

    const { where } = (mockPrisma.startupInvestor.findMany as jest.Mock).mock.calls[0][0];
    expect(where.AND[0].pipeline).toEqual({ some: { stage: "term_sheet" } });
    expect(where.AND[1]).toHaveProperty("OR");
  });

  it("counts both tabs against the same search, so the badges follow the filter", async () => {
    mockCounts(2, 5);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    await service.listInvestors(STARTUP_ID, { ...DEFAULT_QUERY, search: "seed" } as never);

    const countCalls = (mockPrisma.startupInvestor.count as jest.Mock).mock.calls;
    for (const [{ where }] of countCalls) {
      expect(where.AND[0].OR).toEqual(
        expect.arrayContaining([{ fullName: { contains: "seed", mode: "insensitive" } }]),
      );
    }
  });

  it("joins the pipeline entry and converts Decimal amounts to numbers", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      {
        id: CONTACT_ID,
        fullName: "Ada",
        pipeline: [
          {
            id: "p1",
            stage: "due_diligence",
            expectedAmount: new Prisma.Decimal("250000"),
            probabilityPercentage: 70,
          },
        ],
      },
    ]);

    const result = await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(result.data[0]!.pipeline).toEqual({
      id: "p1",
      stage: "due_diligence",
      expectedAmount: 250000,
      probabilityPercentage: 70,
    });
    expect(typeof (result.data[0]!.pipeline as { expectedAmount: number }).expectedAmount).toBe(
      "number",
    );
  });

  it("returns a null pipeline for contacts not in the pipeline", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      { id: CONTACT_ID, fullName: "Ada", pipeline: [] },
    ]);

    const result = await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(result.data[0]!.pipeline).toBeNull();
    expect(result.data[0]!.nextFollowupDate).toBeNull();
  });

  it("attaches the earliest open follow-up date, including overdue dates", async () => {
    const followup = new Date("2020-01-01T00:00:00.000Z");
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      { id: CONTACT_ID, fullName: "Ada", pipeline: [] },
    ]);
    // Three grouped queries now share this mock the follow-up one asks for
    // _min, the two last-touch ones for _max.
    (mockPrisma.interactionLog.groupBy as jest.Mock).mockImplementation((args) =>
      Promise.resolve(
        args._min ? [{ startupInvestorId: CONTACT_ID, _min: { nextFollowupDate: followup } }] : [],
      ),
    );

    const result = await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(result.data[0]!.nextFollowupDate).toEqual(followup);
    expect(mockPrisma.interactionLog.groupBy).toHaveBeenCalledWith({
      by: ["startupInvestorId"],
      where: {
        startupInvestorId: { in: [CONTACT_ID] },
        nextFollowupDate: { not: null },
        followupCompletedAt: null,
      },
      _min: { nextFollowupDate: true },
    });
  });

  it("attaches the newest interaction date as last contact", async () => {
    const interaction = new Date("2026-03-01T00:00:00.000Z");
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      { id: CONTACT_ID, fullName: "Ada", pipeline: [] },
    ]);
    (mockPrisma.interactionLog.groupBy as jest.Mock).mockImplementation((args) =>
      Promise.resolve(
        args._max?.interactionDate
          ? [{ startupInvestorId: CONTACT_ID, _max: { interactionDate: interaction } }]
          : [],
      ),
    );

    const result = await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(result.data[0]!.lastInteractionDate).toEqual(interaction);
  });

  it("falls back to a log's createdAt when it carries no interaction date", async () => {
    const written = new Date("2026-04-01T00:00:00.000Z");
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      { id: CONTACT_ID, fullName: "Ada", pipeline: [] },
    ]);
    (mockPrisma.interactionLog.groupBy as jest.Mock).mockImplementation((args) =>
      Promise.resolve(
        args._max?.createdAt ? [{ startupInvestorId: CONTACT_ID, _max: { createdAt: written } }] : [],
      ),
    );

    const result = await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(result.data[0]!.lastInteractionDate).toEqual(written);
  });

  it("prefers a real interaction date over an undated log written later", async () => {
    const interaction = new Date("2026-05-01T00:00:00.000Z");
    const writtenEarlier = new Date("2026-04-01T00:00:00.000Z");
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      { id: CONTACT_ID, fullName: "Ada", pipeline: [] },
    ]);
    (mockPrisma.interactionLog.groupBy as jest.Mock).mockImplementation((args) =>
      Promise.resolve(
        args._max?.interactionDate
          ? [{ startupInvestorId: CONTACT_ID, _max: { interactionDate: interaction } }]
          : args._max?.createdAt
            ? [{ startupInvestorId: CONTACT_ID, _max: { createdAt: writtenEarlier } }]
            : [],
      ),
    );

    const result = await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(result.data[0]!.lastInteractionDate).toEqual(interaction);
  });

  it("resolves follow-ups and last contact in a fixed number of grouped queries, not per row", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(3);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      { id: "a", fullName: "A", pipeline: [] },
      { id: "b", fullName: "B", pipeline: [] },
      { id: "c", fullName: "C", pipeline: [] },
    ]);

    await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    // One for the follow-up date, two for last contact (dated vs. undated
    // logs) constant regardless of how many contacts are on the page.
    expect(mockPrisma.interactionLog.groupBy).toHaveBeenCalledTimes(3);
    expect(mockPrisma.interactionLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ startupInvestorId: { in: ["a", "b", "c"] } }),
      }),
    );
  });

  it("skips the follow-up query entirely when the page is empty", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(mockPrisma.interactionLog.groupBy).not.toHaveBeenCalled();
  });

  it("always scopes the query to the startup", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(mockPrisma.startupInvestor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ startupId: STARTUP_ID }) }),
    );
  });

  it("builds a case-insensitive search across name, email and firm", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    await service.listInvestors(STARTUP_ID, { ...DEFAULT_QUERY, search: "accel" } as never);

    const { where } = (mockPrisma.startupInvestor.findMany as jest.Mock).mock.calls[0][0];
    expect(where.OR).toEqual([
      { fullName: { contains: "accel", mode: "insensitive" } },
      { email: { contains: "accel", mode: "insensitive" } },
      { ventureFirm: { contains: "accel", mode: "insensitive" } },
    ]);
  });

  it("filters on the joined pipeline stage", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    await service.listInvestors(STARTUP_ID, {
      ...DEFAULT_QUERY,
      stage: "term_sheet",
    } as never);

    const { where } = (mockPrisma.startupInvestor.findMany as jest.Mock).mock.calls[0][0];
    expect(where.pipeline).toEqual({ some: { stage: "term_sheet" } });
  });

  it("filters on investor type", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    await service.listInvestors(STARTUP_ID, { ...DEFAULT_QUERY, investorType: "angel" } as never);

    const { where } = (mockPrisma.startupInvestor.findMany as jest.Mock).mock.calls[0][0];
    expect(where.investorType).toBe("angel");
  });
});

describe("InvestorService.getInvestor", () => {
  it("resolves through the startup-scoped composite key", async () => {
    mockFindUnique({ byId: { id: CONTACT_ID, fullName: "Ada", pipeline: [] } });

    await service.getInvestor(STARTUP_ID, CONTACT_ID);

    expect(mockPrisma.startupInvestor.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId_id: { startupId: STARTUP_ID, id: CONTACT_ID } },
      }),
    );
  });

  it("404s for a contact belonging to another startup", async () => {
    mockFindUnique({ byId: null });

    await expect(service.getInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "INVESTOR_NOT_FOUND",
    });
  });
});

describe("InvestorService.updateInvestor", () => {
  it("404s for a contact belonging to another startup", async () => {
    mockFindUnique({ byId: null });

    await expect(
      service.updateInvestor(STARTUP_ID, CONTACT_ID, { fullName: "New" } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "INVESTOR_NOT_FOUND" });

    expect(mockPrisma.startupInvestor.update).not.toHaveBeenCalled();
  });

  it("throws DUPLICATE_EMAIL when another contact already owns the email", async () => {
    mockFindUnique({
      byId: { id: CONTACT_ID, email: "old@example.com" },
      byEmail: { id: OTHER_ID },
    });

    await expect(
      service.updateInvestor(STARTUP_ID, CONTACT_ID, { email: "taken@example.com" } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_EMAIL" });
  });

  it("allows a contact to keep its own email", async () => {
    mockFindUnique({
      byId: { id: CONTACT_ID, email: "ada@example.com" },
      byEmail: { id: CONTACT_ID },
    });
    (mockPrisma.startupInvestor.update as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

    await expect(
      service.updateInvestor(STARTUP_ID, CONTACT_ID, {
        email: "ada@example.com",
        notes: "still warm",
      } as never),
    ).resolves.toBeDefined();
  });

  it("clears a nullable field when null is sent", async () => {
    mockFindUnique({ byId: { id: CONTACT_ID, email: null } });
    (mockPrisma.startupInvestor.update as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

    await service.updateInvestor(STARTUP_ID, CONTACT_ID, { ventureFirm: null } as never);

    expect(mockPrisma.startupInvestor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ventureFirm: null } }),
    );
  });

  // Note authorship is derived from the authenticated caller, never trusted
  // from the body the same rule completedAt follows on tasks.
  describe("note authorship", () => {
    const USER_ID = "00000000-0000-0000-0000-000000000009";
    const EDITOR_ID = "00000000-0000-0000-0000-00000000000a";

    function updateData() {
      return (mockPrisma.startupInvestor.update as jest.Mock).mock.calls[0][0].data;
    }

    it("records author and editor when the first note is written", async () => {
      mockFindUnique({ byId: { id: CONTACT_ID, email: null, notes: null, notesCreatedAt: null } });
      (mockPrisma.startupInvestor.update as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

      await service.updateInvestor(STARTUP_ID, CONTACT_ID, { notes: "warm" } as never, USER_ID);

      expect(updateData()).toMatchObject({
        notes: "warm",
        notesCreatedBy: USER_ID,
        notesUpdatedBy: USER_ID,
        notesCreatedAt: expect.any(Date),
        notesUpdatedAt: expect.any(Date),
      });
    });

    it("keeps the original author when someone else edits the note", async () => {
      mockFindUnique({
        byId: {
          id: CONTACT_ID,
          email: null,
          notes: "warm",
          notesCreatedAt: new Date("2026-01-01"),
        },
      });
      (mockPrisma.startupInvestor.update as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

      await service.updateInvestor(STARTUP_ID, CONTACT_ID, { notes: "warmer" } as never, EDITOR_ID);

      const data = updateData();
      expect(data).toMatchObject({ notesUpdatedBy: EDITOR_ID, notesUpdatedAt: expect.any(Date) });
      expect(data).not.toHaveProperty("notesCreatedBy");
      expect(data).not.toHaveProperty("notesCreatedAt");
    });

    it("clears authorship with the note, so a new note never inherits a byline", async () => {
      mockFindUnique({
        byId: {
          id: CONTACT_ID,
          email: null,
          notes: "warm",
          notesCreatedAt: new Date("2026-01-01"),
        },
      });
      (mockPrisma.startupInvestor.update as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

      await service.updateInvestor(STARTUP_ID, CONTACT_ID, { notes: null } as never, USER_ID);

      expect(updateData()).toMatchObject({
        notes: null,
        notesCreatedAt: null,
        notesCreatedBy: null,
        notesUpdatedAt: null,
        notesUpdatedBy: null,
      });
    });

    it("does not touch the timestamps when the note is resubmitted unchanged", async () => {
      mockFindUnique({
        byId: {
          id: CONTACT_ID,
          email: null,
          notes: "warm",
          notesCreatedAt: new Date("2026-01-01"),
        },
      });
      (mockPrisma.startupInvestor.update as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

      await service.updateInvestor(
        STARTUP_ID,
        CONTACT_ID,
        { notes: "warm", ventureFirm: "Acme" } as never,
        USER_ID,
      );

      expect(updateData()).toEqual({ notes: "warm", ventureFirm: "Acme" });
    });

    it("leaves authorship alone when the update does not mention the note", async () => {
      mockFindUnique({
        byId: { id: CONTACT_ID, email: null, notes: "warm", notesCreatedAt: new Date("2026-01-01") },
      });
      (mockPrisma.startupInvestor.update as jest.Mock).mockResolvedValue({ id: CONTACT_ID });

      await service.updateInvestor(STARTUP_ID, CONTACT_ID, { sectorFocus: "Fintech" } as never, USER_ID);

      expect(updateData()).toEqual({ sectorFocus: "Fintech" });
    });
  });
});

describe("InvestorService.deleteInvestor", () => {
  /** All three FKs cascade, so each must be blocked explicitly. */
  function mockDependents({ pipeline = 0, commitments = 0, logs = 0 }) {
    mockFindUnique({ byId: { id: CONTACT_ID } });
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(pipeline);
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(commitments);
    (mockPrisma.interactionLog.count as jest.Mock).mockResolvedValue(logs);
  }

  it("404s for a contact belonging to another startup", async () => {
    mockFindUnique({ byId: null });

    await expect(service.deleteInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "INVESTOR_NOT_FOUND",
    });
  });

  it("refuses to delete a contact with pipeline entries", async () => {
    mockDependents({ pipeline: 1 });

    await expect(service.deleteInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "HAS_DEPENDENTS",
      message: "This contact has pipeline entries and cannot be deleted",
    });

    expect(mockPrisma.startupInvestor.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a contact with commitments", async () => {
    mockDependents({ commitments: 1 });

    await expect(service.deleteInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "HAS_DEPENDENTS",
    });
  });

  it("refuses to delete a contact whose only dependents are interaction logs", async () => {
    mockDependents({ logs: 1 });

    await expect(service.deleteInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "HAS_DEPENDENTS",
      message: "This contact has interaction logs and cannot be deleted",
    });

    // The FK cascades without the guard this delete would have destroyed the
    // logged history instead of failing.
    expect(mockPrisma.startupInvestor.delete).not.toHaveBeenCalled();
  });

  it("names every blocking dependent in the message", async () => {
    mockDependents({ pipeline: 2, commitments: 1, logs: 4 });

    await expect(service.deleteInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      message: "This contact has pipeline entries, commitments and interaction logs and cannot be deleted",
    });
  });

  it("deletes a contact with no dependents", async () => {
    mockDependents({});
    (mockPrisma.startupInvestor.delete as jest.Mock).mockResolvedValue({});

    await service.deleteInvestor(STARTUP_ID, CONTACT_ID);

    expect(mockPrisma.startupInvestor.delete).toHaveBeenCalledWith({ where: { id: CONTACT_ID } });
  });
});
