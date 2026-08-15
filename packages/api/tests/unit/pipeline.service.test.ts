import { Prisma } from "@prisma/client";
import { PipelineService } from "../../src/services/pipeline.service";

jest.mock("../../src/db/prisma", () => {
  const client: Record<string, unknown> = {
    startupInvestor: { findUnique: jest.fn() },
    pipeline: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    pipelineStageEvent: { create: jest.fn(), findMany: jest.fn() },
    commitment: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    commitmentStatusEvent: { createMany: jest.fn() },
    fundraisingRound: { findUnique: jest.fn(), findMany: jest.fn() },
    task: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
    interactionLog: { groupBy: jest.fn() },
    startupMember: { findUnique: jest.fn() },
  };
  // Stage writes run in a transaction; hand the callback the same mock client so
  // assertions still see prisma.pipeline.create et al.
  client.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(client));
  return { prisma: client };
});

import { prisma } from "../../src/db/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new PipelineService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_STARTUP = "00000000-0000-0000-0000-000000000099";
const CONTACT_ID = "00000000-0000-0000-0000-000000000002";
const PIPELINE_ID = "00000000-0000-0000-0000-000000000003";
const USER_ID = "00000000-0000-0000-0000-000000000004";
const ROUND_ID = "00000000-0000-0000-0000-000000000005";

const CONTACT = {
  id: CONTACT_ID,
  startupId: STARTUP_ID,
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  ventureFirm: "Analytical Engines",
  investorType: "vc",
  sectorFocus: "AI",
  investmentStagePreference: "Seed",
  linkedinUrl: null,
  notes: null,
  source: "event",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PIPELINE_ID,
    startupId: STARTUP_ID,
    roundId: ROUND_ID,
    startupInvestorId: CONTACT_ID,
    stage: "sourced",
    expectedAmount: new Prisma.Decimal(250000),
    probabilityPercentage: 40,
    stageChangedAt: new Date("2026-01-02"),
    createdAt: new Date("2026-01-02"),
    updatedAt: new Date("2026-01-03"),
    startupInvestor: CONTACT,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.pipelineStageEvent.create as jest.Mock).mockResolvedValue({});
  (mockPrisma.commitment.findMany as jest.Mock).mockResolvedValue([]);
  (mockPrisma.pipeline.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: null } });
  (mockPrisma.fundraisingRound.findMany as jest.Mock).mockResolvedValue([{ id: ROUND_ID }]);
  (mockPrisma.task.count as jest.Mock).mockResolvedValue(0);
});

describe("PipelineService.createEntry", () => {
  it.each(["committed", "passed"])("rejects terminal initial stage %s before touching the database", async (stage) => {
    await expect(
      service.createEntry(STARTUP_ID, { investorId: CONTACT_ID, stage } as never),
    ).rejects.toMatchObject({ statusCode: 400, code: "INITIAL_STAGE_NOT_ALLOWED" });

    expect(mockPrisma.startupInvestor.findUnique).not.toHaveBeenCalled();
  });

  it("creates an entry scoped to the startup and nests the contact", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(entryRow());

    const result = await service.createEntry(STARTUP_ID, {
      investorId: CONTACT_ID,
      stage: "sourced",
      expectedAmount: 250000,
      probabilityPercentage: 40,
    } as never);

    expect(mockPrisma.startupInvestor.findUnique).toHaveBeenCalledWith({
      where: { startupId_id: { startupId: STARTUP_ID, id: CONTACT_ID } },
      select: { id: true },
    });
    expect(mockPrisma.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startupId: STARTUP_ID,
          roundId: ROUND_ID,
          startupInvestorId: CONTACT_ID,
          stage: "sourced",
          expectedAmount: 250000,
          probabilityPercentage: 40,
        }),
      }),
    );
    expect(result.investorId).toBe(CONTACT_ID);
    expect(result.investor.fullName).toBe("Ada Lovelace");
    expect(result.expectedAmount).toBe(250000);
    expect(typeof result.expectedAmount).toBe("number");
  });

  it("throws INVESTOR_NOT_FOUND when the contact belongs to another startup", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createEntry(STARTUP_ID, {
        investorId: CONTACT_ID,
        stage: "contacted",
      } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "INVESTOR_NOT_FOUND" });

    expect(mockPrisma.pipeline.create).not.toHaveBeenCalled();
  });

  it("accepts an explicit round only when it belongs to this startup", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.fundraisingRound.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createEntry(STARTUP_ID, {
        investorId: CONTACT_ID,
        roundId: ROUND_ID,
        stage: "sourced",
      } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "FUNDRAISING_ROUND_NOT_FOUND" });

    expect(mockPrisma.pipeline.create).not.toHaveBeenCalled();
  });

  it.each(["closed", "cancelled"])("refuses to add a deal to a %s round", async (status) => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.fundraisingRound.findUnique as jest.Mock).mockResolvedValue({
      id: ROUND_ID,
      status,
      roundName: "Seed",
    });

    await expect(
      service.createEntry(STARTUP_ID, {
        investorId: CONTACT_ID,
        roundId: ROUND_ID,
        stage: "sourced",
      } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "ROUND_NOT_OPEN" });

    expect(mockPrisma.pipeline.create).not.toHaveBeenCalled();
  });

  it.each(["draft", "active"])("adds a deal to a %s round", async (status) => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.fundraisingRound.findUnique as jest.Mock).mockResolvedValue({
      id: ROUND_ID,
      status,
      roundName: "Seed",
    });
    (mockPrisma.pipeline.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: 0 } });
    (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(entryRow());

    await service.createEntry(STARTUP_ID, {
      investorId: CONTACT_ID,
      roundId: ROUND_ID,
      stage: "sourced",
    } as never);

    expect(mockPrisma.pipeline.create).toHaveBeenCalled();
  });

  it("uses a legacy client request only when exactly one active round exists", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.fundraisingRound.findMany as jest.Mock).mockResolvedValue([
      { id: "round-a" },
      { id: "round-b" },
    ]);

    await expect(
      service.createEntry(STARTUP_ID, { investorId: CONTACT_ID, stage: "sourced" } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "FUNDRAISING_ROUND_REQUIRED" });
  });

  it("translates a unique-constraint race into ALREADY_IN_PIPELINE", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.pipeline.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );

    await expect(
      service.createEntry(STARTUP_ID, {
        investorId: CONTACT_ID,
        stage: "sourced",
      } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_IN_PIPELINE" });
  });

  it("rethrows unrelated database errors untouched", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.pipeline.create as jest.Mock).mockRejectedValue(new Error("connection lost"));

    await expect(
      service.createEntry(STARTUP_ID, {
        investorId: CONTACT_ID,
        stage: "sourced",
      } as never),
    ).rejects.toThrow("connection lost");
  });

  it("converts a null Decimal expectedAmount to null (not a string)", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(
      entryRow({ expectedAmount: null, probabilityPercentage: null }),
    );

    const result = await service.createEntry(STARTUP_ID, {
      investorId: CONTACT_ID,
      stage: "sourced",
    } as never);

    expect(result.expectedAmount).toBeNull();
  });

  it("joins the bottom of an empty column at sortOrder 1000", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.pipeline.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: null } });
    (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(entryRow());

    await service.createEntry(STARTUP_ID, { investorId: CONTACT_ID, stage: "sourced" } as never);

    expect(mockPrisma.pipeline.aggregate).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, roundId: ROUND_ID, stage: "sourced" },
      _max: { sortOrder: true },
    });
    expect(mockPrisma.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sortOrder: 1000 }) }),
    );
  });

  it("joins the bottom below the current highest sortOrder in that stage", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.pipeline.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: 3500 } });
    (mockPrisma.pipeline.create as jest.Mock).mockResolvedValue(entryRow());

    await service.createEntry(STARTUP_ID, { investorId: CONTACT_ID, stage: "sourced" } as never);

    expect(mockPrisma.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sortOrder: 4500 }) }),
    );
  });
});

describe("PipelineService.listEntries", () => {
  it("returns pagination meta alongside the rows", async () => {
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(45);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listEntries(STARTUP_ID, { page: 2, limit: 20 } as never);

    expect(result.meta).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
    expect(mockPrisma.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });

  it("filters by stage when provided", async () => {
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    await service.listEntries(STARTUP_ID, {
      page: 1,
      limit: 20,
      stage: "due_diligence",
    } as never);

    expect(mockPrisma.pipeline.count).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, roundId: ROUND_ID, stage: "due_diligence" },
    });
  });

  it("serializes Decimal expectedAmount as a number on each row", async () => {
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([entryRow()]);

    const result = await service.listEntries(STARTUP_ID, { page: 1, limit: 20 } as never);

    expect(result.data[0].expectedAmount).toBe(250000);
    expect(typeof result.data[0].expectedAmount).toBe("number");
  });

  // These four params answer the board's search box and its Mine/Attention/
  // Show passed toggles server-side, rather than the client re-filtering an
  // already-fetched page.
  it("matches search against the investor's name and firm, case-insensitively", async () => {
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    await service.listEntries(STARTUP_ID, { page: 1, limit: 20, search: "acme" } as never);

    expect(mockPrisma.pipeline.count).toHaveBeenCalledWith({
      where: {
        startupId: STARTUP_ID,
        roundId: ROUND_ID,
        startupInvestor: {
          OR: [
            { fullName: { contains: "acme", mode: "insensitive" } },
            { ventureFirm: { contains: "acme", mode: "insensitive" } },
          ],
        },
      },
    });
  });

  it("filters by ownerId when provided", async () => {
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);
    const ownerId = "00000000-0000-0000-0000-000000000006";

    await service.listEntries(STARTUP_ID, { page: 1, limit: 20, ownerId } as never);

    expect(mockPrisma.pipeline.count).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, roundId: ROUND_ID, ownerId },
    });
  });

  it("excludes passed deals when showPassed is false", async () => {
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    await service.listEntries(STARTUP_ID, { page: 1, limit: 20, showPassed: false } as never);

    expect(mockPrisma.pipeline.count).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, roundId: ROUND_ID, stage: { not: "passed" } },
    });
  });

  it("lets an explicit stage win over showPassed=false", async () => {
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    await service.listEntries(STARTUP_ID, {
      page: 1,
      limit: 20,
      stage: "sourced",
      showPassed: false,
    } as never);

    expect(mockPrisma.pipeline.count).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, roundId: ROUND_ID, stage: "sourced" },
    });
  });

  it("narrows to getFocus's own ids when attentionOnly is set, rather than re-deriving the criteria", async () => {
    (mockPrisma.pipeline.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);
    const focusSpy = jest
      .spyOn(service, "getFocus")
      .mockResolvedValueOnce({ data: [{ id: PIPELINE_ID }] } as never);

    try {
      await service.listEntries(STARTUP_ID, { page: 1, limit: 20, attentionOnly: true } as never);

      expect(focusSpy).toHaveBeenCalledWith(STARTUP_ID, ROUND_ID);
      expect(mockPrisma.pipeline.count).toHaveBeenCalledWith({
        where: { startupId: STARTUP_ID, roundId: ROUND_ID, id: { in: [PIPELINE_ID] } },
      });
    } finally {
      focusSpy.mockRestore();
    }
  });
});

describe("PipelineService.getEntry", () => {
  it("resolves via the [startupId, id] composite", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(entryRow());

    const result = await service.getEntry(STARTUP_ID, PIPELINE_ID);

    expect(mockPrisma.pipeline.findUnique).toHaveBeenCalledWith({
      where: { startupId_id: { startupId: STARTUP_ID, id: PIPELINE_ID } },
      select: expect.any(Object),
    });
    expect(result.id).toBe(PIPELINE_ID);
  });

  it("throws PIPELINE_NOT_FOUND for a missing or cross-tenant id", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getEntry(OTHER_STARTUP, PIPELINE_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "PIPELINE_NOT_FOUND",
    });
  });
});

describe("PipelineService.updateEntry moving between rounds", () => {
  const OTHER_ROUND = "00000000-0000-0000-0000-000000000008";
  const EXISTING = {
    id: PIPELINE_ID,
    stage: "contacted",
    roundId: ROUND_ID,
    startupInvestorId: CONTACT_ID,
  };

  beforeEach(() => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(EXISTING);
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow({ roundId: OTHER_ROUND }));
    (mockPrisma.fundraisingRound.findUnique as jest.Mock).mockResolvedValue({
      id: OTHER_ROUND,
      status: "active",
      roundName: "Series A",
    });
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: 3000 } });
  });

  it("lands the deal at the bottom of the matching column in the destination", async () => {
    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { roundId: OTHER_ROUND } as never);

    expect(mockPrisma.pipeline.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: STARTUP_ID, roundId: OTHER_ROUND, stage: "contacted" },
      }),
    );
    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roundId: OTHER_ROUND, sortOrder: 4000 }),
      }),
    );
    expect(mockPrisma.pipelineStageEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roundId: OTHER_ROUND,
          fromStage: null,
          toStage: "contacted",
        }),
      }),
    );
  });

  it("records a simultaneous new commitment against the destination round", async () => {
    (mockPrisma.commitment.findFirst as jest.Mock).mockResolvedValue(null);

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, {
      roundId: OTHER_ROUND,
      stage: "committed",
      commitment: { amount: 250_000, status: "soft_circled" },
    } as never);

    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roundId: OTHER_ROUND, stage: "committed" }),
      }),
    );
    expect(mockPrisma.commitment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roundId: OTHER_ROUND, pipelineId: PIPELINE_ID }),
      }),
    );
  });

  it.each(["closed", "cancelled"])("refuses to carry a deal into a %s round", async (status) => {
    (mockPrisma.fundraisingRound.findUnique as jest.Mock).mockResolvedValue({
      id: OTHER_ROUND,
      status,
      roundName: "Series A",
    });

    await expect(
      service.updateEntry(STARTUP_ID, PIPELINE_ID, { roundId: OTHER_ROUND } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "ROUND_NOT_OPEN" });

    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
  });

  it("throws FUNDRAISING_ROUND_NOT_FOUND for a round in another startup", async () => {
    (mockPrisma.fundraisingRound.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.updateEntry(STARTUP_ID, PIPELINE_ID, { roundId: OTHER_ROUND } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "FUNDRAISING_ROUND_NOT_FOUND" });
  });

  // The money was pledged to a specific raise; carrying the deal across would
  // silently re-attribute it.
  it("refuses when the deal has commitments against its current round", async () => {
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(1);

    await expect(
      service.updateEntry(STARTUP_ID, PIPELINE_ID, { roundId: OTHER_ROUND } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "HAS_DEPENDENTS" });

    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
  });

  it("reports a clean conflict when the investor already has a deal in the destination", async () => {
    (mockPrisma.pipeline.update as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );

    await expect(
      service.updateEntry(STARTUP_ID, PIPELINE_ID, { roundId: OTHER_ROUND } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_IN_PIPELINE" });
  });

  it("does not touch the round when the same one is sent back", async () => {
    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { roundId: ROUND_ID } as never);

    // No verification, no repositioning it is not a move.
    expect(mockPrisma.pipeline.aggregate).not.toHaveBeenCalled();
    expect(mockPrisma.commitment.count).not.toHaveBeenCalled();
  });
});

describe("PipelineService.updateEntry committing", () => {
  const COMMITTING = {
    id: PIPELINE_ID,
    stage: "term_sheet",
    roundId: ROUND_ID,
    startupInvestorId: CONTACT_ID,
  };

  beforeEach(() => {
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow({ stage: "committed" }));
  });

  it("records the round's commitment in the same transaction as the stage move", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(COMMITTING);
    (mockPrisma.commitment.findFirst as jest.Mock).mockResolvedValue(null);

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, {
      stage: "committed",
      commitment: { amount: 250_000, status: "pending" },
    } as never);

    expect(mockPrisma.commitment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        startupId: STARTUP_ID,
        startupInvestorId: CONTACT_ID,
        pipelineId: PIPELINE_ID,
        roundId: ROUND_ID,
        amount: 250_000,
        status: "pending",
      }),
    });
  });

  it("refuses the move when no commitment details are given and none exists yet", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(COMMITTING);
    (mockPrisma.commitment.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "committed" } as never),
    ).rejects.toMatchObject({ statusCode: 400, code: "COMMITMENT_DETAILS_REQUIRED" });

    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
  });

  it("allows the move with no details when the round already records a commitment", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(COMMITTING);
    (mockPrisma.commitment.findFirst as jest.Mock).mockResolvedValue({
      id: "c1",
      status: "confirmed",
    });

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "committed" } as never);

    expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
    expect(mockPrisma.pipeline.update).toHaveBeenCalled();
  });

  it("updates the existing commitment rather than stacking a second one", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(COMMITTING);
    (mockPrisma.commitment.findFirst as jest.Mock).mockResolvedValue({
      id: "c1",
      status: "withdrawn",
    });

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, {
      stage: "committed",
      commitment: { amount: 300_000, status: "confirmed" },
    } as never);

    expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
    expect(mockPrisma.commitment.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ amount: 300_000, status: "confirmed" }),
    });
  });

  it("withdraws the commitment when the deal moves back out of committed", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      ...COMMITTING,
      stage: "committed",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow({ stage: "term_sheet" }));

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "term_sheet" } as never);

    // The row survives as history rather than being deleted anything
    // already marked funded must not silently vanish from the round.
    expect(mockPrisma.commitment.updateMany).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, pipelineId: PIPELINE_ID, status: { not: "withdrawn" } },
      data: { status: "withdrawn" },
    });
  });

  it("records funding-history events for automatic commitment withdrawals", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      ...COMMITTING,
      stage: "committed",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow({ stage: "term_sheet" }));
    (mockPrisma.commitment.findMany as jest.Mock).mockResolvedValue([
      { id: "commitment-1", status: "hard_circled" },
      { id: "commitment-2", status: "soft_circled" },
    ]);

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "term_sheet" } as never, USER_ID);

    expect(mockPrisma.commitmentStatusEvent.createMany).toHaveBeenCalledWith({
      data: [
        { startupId: STARTUP_ID, commitmentId: "commitment-1", fromStatus: "hard_circled", toStatus: "withdrawn", changedBy: USER_ID },
        { startupId: STARTUP_ID, commitmentId: "commitment-2", fromStatus: "soft_circled", toStatus: "withdrawn", changedBy: USER_ID },
      ],
    });
  });

  it("leaves commitments alone for a move that is not into or out of committed", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(COMMITTING);
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow({ stage: "due_diligence" }));

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "due_diligence" } as never);

    expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
    expect(mockPrisma.commitment.updateMany).not.toHaveBeenCalled();
  });
});

describe("PipelineService.updateEntry", () => {
  it("updates stage and returns a number expectedAmount", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(
      entryRow({ stage: "term_sheet", expectedAmount: new Prisma.Decimal("100000.5") }),
    );

    const result = await service.updateEntry(STARTUP_ID, PIPELINE_ID, {
      stage: "term_sheet",
    } as never);

    expect(result.stage).toBe("term_sheet");
    expect(result.expectedAmount).toBe(100000.5);
  });

  it("throws PIPELINE_NOT_FOUND when the entry is not in this startup", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "passed" } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "PIPELINE_NOT_FOUND" });

    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
  });

  it("reorders within the same stage without touching stage history", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "sourced",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow({ sortOrder: 1500 }));

    const result = await service.updateEntry(STARTUP_ID, PIPELINE_ID, {
      sortOrder: 1500,
    } as never);

    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith({
      where: { id: PIPELINE_ID },
      data: { sortOrder: 1500 },
      select: expect.any(Object),
    });
    expect(mockPrisma.pipelineStageEvent.create).not.toHaveBeenCalled();
    expect(result.sortOrder).toBe(1500);
  });

  it("carries the new sortOrder alongside a real stage move", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "contacted",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(
      entryRow({ stage: "meeting_scheduled", sortOrder: 500 }),
    );

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, {
      stage: "meeting_scheduled",
      sortOrder: 500,
    } as never);

    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: "meeting_scheduled", sortOrder: 500 }),
      }),
    );
  });

  it("appends a stage event and advances stageChangedAt on a real move", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "contacted",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(
      entryRow({ stage: "term_sheet" }),
    );

    await service.updateEntry(
      STARTUP_ID,
      PIPELINE_ID,
      { stage: "term_sheet" } as never,
      USER_ID,
    );

    expect(mockPrisma.pipelineStageEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startupId: STARTUP_ID,
          pipelineId: PIPELINE_ID,
          fromStage: "contacted",
          toStage: "term_sheet",
          changedBy: USER_ID,
        }),
      }),
    );
    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stageChangedAt: expect.any(Date) }),
      }),
    );
  });

  it("leaves stage history alone when only the amount changes", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "contacted",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow());

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { expectedAmount: 5000 } as never);

    expect(mockPrisma.pipelineStageEvent.create).not.toHaveBeenCalled();
    // stageChangedAt must not move, or time-in-stage resets on every edit.
    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expectedAmount: 5000 } }),
    );
  });

  it("treats a no-op stage write as an edit, not a move", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "contacted",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow());

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "contacted" } as never);

    expect(mockPrisma.pipelineStageEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a move to passed with no reason", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "term_sheet",
    });

    await expect(
      service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "passed" } as never),
    ).rejects.toMatchObject({ statusCode: 400, code: "PASSED_REASON_REQUIRED" });

    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
  });

  it("rejects a move to passed with a blank reason", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "term_sheet",
    });

    await expect(
      service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "passed", reason: "   " } as never),
    ).rejects.toMatchObject({ statusCode: 400, code: "PASSED_REASON_REQUIRED" });
  });

  it("records the reason on the stage event, not the pipeline row, when passing", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "term_sheet",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow({ stage: "passed" }));

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, {
      stage: "passed",
      reason: "Went with another investor",
    } as never);

    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ reason: expect.anything() }),
      }),
    );
    expect(mockPrisma.pipelineStageEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toStage: "passed",
          reason: "Went with another investor",
        }),
      }),
    );
  });

  it("does not require a reason for a non-passed transition", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      stage: "sourced",
    });
    (mockPrisma.pipeline.update as jest.Mock).mockResolvedValue(entryRow({ stage: "contacted" }));

    await service.updateEntry(STARTUP_ID, PIPELINE_ID, { stage: "contacted" } as never);

    expect(mockPrisma.pipelineStageEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: null }) }),
    );
  });
});

describe("PipelineService.getAnalytics", () => {
  function event(pipelineId: string, toStage: string, day: number) {
    return { pipelineId, toStage, createdAt: new Date(2026, 0, day) };
  }

  it("counts reach from history, so a passed deal still credits the stages it hit", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([
      { id: "p1", stage: "passed", expectedAmount: new Prisma.Decimal(100), stageChangedAt: new Date() },
    ]);
    (mockPrisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue([
      event("p1", "sourced", 1),
      event("p1", "meeting_scheduled", 5),
      event("p1", "passed", 9),
    ]);

    const { data } = await service.getAnalytics(STARTUP_ID);

    const meeting = data.funnel.find((row) => row.stage === "meeting_scheduled")!;
    expect(meeting.everReached).toBe(1);
    // It reached the meeting stage but sits in "passed" now.
    expect(meeting.current).toBe(0);
    expect(data.outcomes).toMatchObject({ passed: 1, committed: 0, winRate: 0 });
  });

  it("computes conversion as reaching anything further along the funnel", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue([
      // Two deals get contacted; only one goes on to a meeting.
      event("p1", "contacted", 1),
      event("p1", "meeting_scheduled", 3),
      event("p2", "contacted", 2),
    ]);

    const { data } = await service.getAnalytics(STARTUP_ID);

    const contacted = data.conversion.find((row) => row.fromStage === "contacted")!;
    expect(contacted).toMatchObject({ reached: 2, advanced: 1, rate: 0.5 });
  });

  it("excludes the stage a deal currently sits in from median duration", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue([
      event("p1", "sourced", 1),
      event("p1", "contacted", 5),
    ]);

    const { data } = await service.getAnalytics(STARTUP_ID);

    // Four days in sourced; the contacted visit is still running.
    expect(data.funnel.find((row) => row.stage === "sourced")!.medianDaysInStage).toBe(4);
    expect(data.funnel.find((row) => row.stage === "contacted")!.medianDaysInStage).toBeNull();
  });

  it("credits a deal that skipped straight to a later stage to every earlier stage too", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue([
      // p1 goes through every stage normally.
      event("p1", "sourced", 1),
      event("p1", "contacted", 2),
      event("p1", "meeting_scheduled", 3),
      event("p1", "due_diligence", 4),
      // p2 was added directly at due diligence no sourced/contacted/meeting
      // events exist for it, but it plainly cleared those stages too.
      event("p2", "due_diligence", 1),
    ]);

    const { data } = await service.getAnalytics(STARTUP_ID);

    const byStage = (stage: string) => data.funnel.find((row) => row.stage === stage)!.everReached;
    // Every earlier stage must count both deals, not just the one with a
    // matching literal event otherwise a later stage can end up with a
    // higher count than an earlier one, which isn't a funnel anymore.
    expect(byStage("sourced")).toBe(2);
    expect(byStage("contacted")).toBe(2);
    expect(byStage("meeting_scheduled")).toBe(2);
    expect(byStage("due_diligence")).toBe(2);
  });

  it("returns null rates rather than dividing by zero on an empty board", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue([]);

    const { data } = await service.getAnalytics(STARTUP_ID);

    expect(data.totalDeals).toBe(0);
    expect(data.outcomes.winRate).toBeNull();
    expect(data.conversion.every((row) => row.rate === null)).toBe(true);
  });
});

describe("PipelineService.deleteEntry", () => {
  it("deletes when there are no commitment or open-task dependents", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.task.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.delete as jest.Mock).mockResolvedValue({});

    await service.deleteEntry(STARTUP_ID, PIPELINE_ID);

    expect(mockPrisma.commitment.count).toHaveBeenCalledWith({
      where: { pipelineId: PIPELINE_ID, startupId: STARTUP_ID },
    });
    // Only unfinished work blocks a completed checklist must not strand the
    // deal on the board forever.
    expect(mockPrisma.task.count).toHaveBeenCalledWith({
      where: { pipelineId: PIPELINE_ID, startupId: STARTUP_ID, status: "open" },
    });
    expect(mockPrisma.pipeline.delete).toHaveBeenCalledWith({ where: { id: PIPELINE_ID } });
  });

  it("sweeps the deal's completed tasks in the same transaction as the delete", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.task.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.delete as jest.Mock).mockResolvedValue({});

    await service.deleteEntry(STARTUP_ID, PIPELINE_ID);

    // The pipeline FK is Restrict, so the tasks have to go first or the
    // delete fails on the constraint.
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.task.deleteMany).toHaveBeenCalledWith({
      where: { pipelineId: PIPELINE_ID, startupId: STARTUP_ID },
    });
  });

  it("throws HAS_DEPENDENTS when commitments exist", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(2);

    await expect(service.deleteEntry(STARTUP_ID, PIPELINE_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "HAS_DEPENDENTS",
    });

    expect(mockPrisma.pipeline.delete).not.toHaveBeenCalled();
  });

  it("throws HAS_DEPENDENTS when open tasks exist someone still expects to act on this deal", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.task.count as jest.Mock).mockResolvedValue(3);

    await expect(service.deleteEntry(STARTUP_ID, PIPELINE_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "HAS_DEPENDENTS",
    });

    expect(mockPrisma.pipeline.delete).not.toHaveBeenCalled();
  });

  it("throws PIPELINE_NOT_FOUND when the entry does not exist", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.deleteEntry(STARTUP_ID, PIPELINE_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "PIPELINE_NOT_FOUND",
    });
  });
});

describe("PipelineService.listStageEvents", () => {
  it("returns the history oldest first", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    const events = [
      { id: "e1", roundId: ROUND_ID, fromStage: null, toStage: "sourced", changedBy: USER_ID, createdAt: new Date("2026-01-01") },
      { id: "e2", roundId: ROUND_ID, fromStage: "sourced", toStage: "contacted", changedBy: USER_ID, createdAt: new Date("2026-01-05") },
    ];
    (mockPrisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue(events);

    const result = await service.listStageEvents(STARTUP_ID, PIPELINE_ID);

    expect(mockPrisma.pipelineStageEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: STARTUP_ID, pipelineId: PIPELINE_ID },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(result.data).toEqual(events);
  });

  it("throws PIPELINE_NOT_FOUND for a missing or cross-tenant id", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.listStageEvents(OTHER_STARTUP, PIPELINE_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "PIPELINE_NOT_FOUND",
    });
    expect(mockPrisma.pipelineStageEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("PipelineService.getFocus", () => {
  const NOW = new Date("2026-08-14T12:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    (mockPrisma.fundraisingRound.findUnique as jest.Mock).mockResolvedValue({ id: ROUND_ID });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function deal(id: string, overrides: Record<string, unknown> = {}) {
    return entryRow({
      id,
      startupInvestorId: `contact-${id}`,
      stage: "contacted",
      priority: null,
      ...overrides,
    });
  }

  /**
   * Last touch is two grouped queries dated logs aggregated by
   * interactionDate, undated ones by createdAt. `dated`/`undated` map a
   * contact id to the aggregate that query should report for it.
   */
  function mockLastTouch(
    dated: Record<string, Date> = {},
    undated: Record<string, Date> = {},
  ) {
    (mockPrisma.interactionLog.groupBy as jest.Mock).mockImplementation((args) =>
      Promise.resolve(
        args._max?.interactionDate
          ? Object.entries(dated).map(([startupInvestorId, at]) => ({
              startupInvestorId,
              _max: { interactionDate: at },
            }))
          : Object.entries(undated).map(([startupInvestorId, at]) => ({
              startupInvestorId,
              _max: { createdAt: at },
            })),
      ),
    );
  }

  it("only queries non-settled deals in the resolved round", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    await service.getFocus(STARTUP_ID, ROUND_ID);

    expect(mockPrisma.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: STARTUP_ID, roundId: ROUND_ID, stage: { notIn: ["committed", "passed"] } },
      }),
    );
  });

  it("flags a deal whose soonest open task is overdue", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([deal("p1")]);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      { pipelineId: "p1", dueDate: new Date(NOW.getTime() - 4 * DAY) },
    ]);
    mockLastTouch();

    const { data } = await service.getFocus(STARTUP_ID, ROUND_ID);

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: "p1", reason: "overdue" });
  });

  it("flags a deal with no open task at all as missing", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([deal("p1")]);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([]);
    mockLastTouch({ "contact-p1": NOW });

    const { data } = await service.getFocus(STARTUP_ID, ROUND_ID);

    expect(data[0]).toMatchObject({ id: "p1", reason: "missing" });
  });

  it("flags a deal as quiet only when it has an open task but no contact in 14+ days", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([deal("p1")]);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      { pipelineId: "p1", dueDate: new Date(NOW.getTime() + 30 * DAY) },
    ]);
    mockLastTouch({ "contact-p1": new Date(NOW.getTime() - 20 * DAY) });

    const { data } = await service.getFocus(STARTUP_ID, ROUND_ID);

    expect(data[0]).toMatchObject({ id: "p1", reason: "quiet" });
  });

  it("flags a high-priority deal with no other signal, and ranks it last", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([
      deal("overdue-deal"),
      deal("priority-deal", { priority: "high" }),
    ]);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      { pipelineId: "overdue-deal", dueDate: new Date(NOW.getTime() - DAY) },
      { pipelineId: "priority-deal", dueDate: new Date(NOW.getTime() + 30 * DAY) },
    ]);
    mockLastTouch({ "contact-overdue-deal": NOW, "contact-priority-deal": NOW });

    const { data } = await service.getFocus(STARTUP_ID, ROUND_ID);

    expect(data.map((row) => row.id)).toEqual(["overdue-deal", "priority-deal"]);
    expect(data[1].reason).toBe("priority");
  });

  it("excludes a deal that has an upcoming task, recent contact, and no priority flag", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([deal("p1")]);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      { pipelineId: "p1", dueDate: new Date(NOW.getTime() + 5 * DAY) },
    ]);
    mockLastTouch({ "contact-p1": NOW });

    const { data } = await service.getFocus(STARTUP_ID, ROUND_ID);

    expect(data).toHaveLength(0);
  });

  // Regression: last touch used to come from a findMany ordered by the
  // nullable interactionDate. Postgres sorts DESC NULLS FIRST, so one undated
  // log outranked every dated one and pinned the deal's last touch to
  // whenever that row happened to be written.
  it("does not let an undated log override a more recent real interaction", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([deal("p1")]);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      { pipelineId: "p1", dueDate: new Date(NOW.getTime() + 30 * DAY) },
    ]);
    mockLastTouch(
      { "contact-p1": new Date(NOW.getTime() - DAY) },
      { "contact-p1": new Date(NOW.getTime() - 90 * DAY) },
    );

    const { data } = await service.getFocus(STARTUP_ID, ROUND_ID);

    // Spoken to yesterday, so not quiet and nothing else applies.
    expect(data).toHaveLength(0);
  });

  it("falls back to an undated log's createdAt when no dated log exists", async () => {
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([deal("p1")]);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      { pipelineId: "p1", dueDate: new Date(NOW.getTime() + 30 * DAY) },
    ]);
    mockLastTouch({}, { "contact-p1": new Date(NOW.getTime() - 20 * DAY) });

    const { data } = await service.getFocus(STARTUP_ID, ROUND_ID);

    expect(data[0]).toMatchObject({ id: "p1", reason: "quiet", daysQuiet: 20 });
  });
});
