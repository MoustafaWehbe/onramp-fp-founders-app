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
    commitment: { count: jest.fn() },
    fundraisingRound: { findUnique: jest.fn(), findMany: jest.fn() },
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
  (mockPrisma.pipeline.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: null } });
  (mockPrisma.fundraisingRound.findMany as jest.Mock).mockResolvedValue([{ id: ROUND_ID }]);
});

describe("PipelineService.createEntry", () => {
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
      // p2 was added directly at due diligence — no sourced/contacted/meeting
      // events exist for it, but it plainly cleared those stages too.
      event("p2", "due_diligence", 1),
    ]);

    const { data } = await service.getAnalytics(STARTUP_ID);

    const byStage = (stage: string) => data.funnel.find((row) => row.stage === stage)!.everReached;
    // Every earlier stage must count both deals, not just the one with a
    // matching literal event — otherwise a later stage can end up with a
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
  it("deletes when there are no commitment dependents", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.commitment.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.pipeline.delete as jest.Mock).mockResolvedValue({});

    await service.deleteEntry(STARTUP_ID, PIPELINE_ID);

    expect(mockPrisma.commitment.count).toHaveBeenCalledWith({
      where: { pipelineId: PIPELINE_ID, startupId: STARTUP_ID },
    });
    expect(mockPrisma.pipeline.delete).toHaveBeenCalledWith({ where: { id: PIPELINE_ID } });
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
      { id: "e1", fromStage: null, toStage: "sourced", changedBy: USER_ID, createdAt: new Date("2026-01-01") },
      { id: "e2", fromStage: "sourced", toStage: "contacted", changedBy: USER_ID, createdAt: new Date("2026-01-05") },
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
