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
    interactionLog: { groupBy: jest.fn() },
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
  it("returns pagination meta alongside the rows", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(45);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listInvestors(STARTUP_ID, { page: 2, limit: 20 } as never);

    expect(result.meta).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
    expect(mockPrisma.startupInvestor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
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

  it("attaches the earliest upcoming follow-up date", async () => {
    const followup = new Date("2030-01-01T00:00:00.000Z");
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      { id: CONTACT_ID, fullName: "Ada", pipeline: [] },
    ]);
    (mockPrisma.interactionLog.groupBy as jest.Mock).mockResolvedValue([
      { startupInvestorId: CONTACT_ID, _min: { nextFollowupDate: followup } },
    ]);

    const result = await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(result.data[0]!.nextFollowupDate).toEqual(followup);
  });

  it("resolves follow-ups in one grouped query rather than per row", async () => {
    (mockPrisma.startupInvestor.count as jest.Mock).mockResolvedValue(3);
    (mockPrisma.startupInvestor.findMany as jest.Mock).mockResolvedValue([
      { id: "a", fullName: "A", pipeline: [] },
      { id: "b", fullName: "B", pipeline: [] },
      { id: "c", fullName: "C", pipeline: [] },
    ]);

    await service.listInvestors(STARTUP_ID, DEFAULT_QUERY as never);

    expect(mockPrisma.interactionLog.groupBy).toHaveBeenCalledTimes(1);
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
});

describe("InvestorService.deleteInvestor", () => {
  it("404s for a contact belonging to another startup", async () => {
    mockFindUnique({ byId: null });

    await expect(service.deleteInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "INVESTOR_NOT_FOUND",
    });
  });

  it("refuses to delete a contact with pipeline entries", async () => {
    mockFindUnique({ byId: { id: CONTACT_ID } });
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(0);

    await expect(service.deleteInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "HAS_DEPENDENTS",
    });

    expect(mockPrisma.startupInvestor.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a contact with commitments", async () => {
    mockFindUnique({ byId: { id: CONTACT_ID } });
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(1);

    await expect(service.deleteInvestor(STARTUP_ID, CONTACT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "HAS_DEPENDENTS",
    });
  });

  it("deletes a contact with no dependents", async () => {
    mockFindUnique({ byId: { id: CONTACT_ID } });
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.startupInvestor.delete as jest.Mock).mockResolvedValue({});

    await service.deleteInvestor(STARTUP_ID, CONTACT_ID);

    expect(mockPrisma.startupInvestor.delete).toHaveBeenCalledWith({ where: { id: CONTACT_ID } });
  });
});
