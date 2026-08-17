import { Prisma } from "@prisma/client";
import { FundraisingService } from "../../src/services/fundraising.service";

jest.mock("../../src/db/prisma", () => {
  const client: Record<string, unknown> = {
    startupInvestor: { findUnique: jest.fn() },
    fundraisingRound: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    pipeline: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    pipelineStageEvent: { create: jest.fn() },
    commitment: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    commitmentStatusEvent: { create: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  // Commitment writes now move the linked deal in the same transaction; hand
  // the callback the same mock client so assertions still see the calls.
  client.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(client));
  return { prisma: client };
});

import { prisma } from "../../src/db/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new FundraisingService();
const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const INVESTOR_ID = "00000000-0000-0000-0000-000000000002";
const ROUND_ID = "00000000-0000-0000-0000-000000000003";
const PIPELINE_ID = "00000000-0000-0000-0000-000000000004";
const USER_ID = "00000000-0000-0000-0000-000000000006";

const investor = { id: INVESTOR_ID, startupId: STARTUP_ID, fullName: "Ada", email: null, ventureFirm: null, investorType: null, sectorFocus: null, investmentStagePreference: null, linkedinUrl: null, notes: null, source: null, createdAt: new Date(), updatedAt: new Date() };
const commitment = { id: "00000000-0000-0000-0000-000000000005", startupId: STARTUP_ID, startupInvestorId: INVESTOR_ID, pipelineId: PIPELINE_ID, roundId: ROUND_ID, amount: new Prisma.Decimal(50000), status: "hard_circled", expectedCloseDate: null, createdAt: new Date(), updatedAt: new Date(), startupInvestor: investor };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.commitment.count.mockResolvedValue(0 as never);
});

describe("FundraisingService.createCommitment", () => {
  it("rejects a pipeline deal that does not belong to the selected investor and round", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue({ id: INVESTOR_ID } as never);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue({ id: ROUND_ID } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue(null);

    await expect(service.createCommitment(STARTUP_ID, { investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000 })).rejects.toMatchObject({ statusCode: 422, code: "PIPELINE_MISMATCH" });
    expect(mockPrisma.pipeline.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ startupId: STARTUP_ID, roundId: ROUND_ID, startupInvestorId: INVESTOR_ID }) }));
  });

  it("creates a commitment only after all linked records have the tenant scope", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue({ id: INVESTOR_ID } as never);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue({ id: ROUND_ID } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({ id: PIPELINE_ID } as never);
    mockPrisma.commitment.create.mockResolvedValue(commitment as never);

    const result = await service.createCommitment(STARTUP_ID, { investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000, status: "hard_circled" });

    expect(result).toMatchObject({ investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000, investor });
    expect(mockPrisma.commitment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ startupId: STARTUP_ID, startupInvestorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID }) }));
    // The first point on this commitment's funding-history timeline.
    expect(mockPrisma.commitmentStatusEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ commitmentId: commitment.id, fromStatus: null, toStatus: "hard_circled" }),
    }));
  });

  // The board and the round page must agree whichever one the founder used.
  it("moves the linked deal to committed and records the stage change", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue({ id: INVESTOR_ID } as never);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue({ id: ROUND_ID } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({ id: PIPELINE_ID } as never);
    mockPrisma.pipeline.findUnique.mockResolvedValue({ id: PIPELINE_ID, stage: "term_sheet", roundId: ROUND_ID } as never);
    mockPrisma.commitment.create.mockResolvedValue(commitment as never);

    await service.createCommitment(STARTUP_ID, { investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000 });

    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PIPELINE_ID }, data: expect.objectContaining({ stage: "committed" }) }));
    expect(mockPrisma.pipelineStageEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roundId: ROUND_ID, fromStage: "term_sheet", toStage: "committed" }) }));
  });

  it("does not re-move a deal that is already committed", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue({ id: INVESTOR_ID } as never);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue({ id: ROUND_ID } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({ id: PIPELINE_ID } as never);
    mockPrisma.pipeline.findUnique.mockResolvedValue({ id: PIPELINE_ID, stage: "committed" } as never);
    mockPrisma.commitment.create.mockResolvedValue(commitment as never);

    await service.createCommitment(STARTUP_ID, { investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000 });

    // No no-op transition should reach the timeline.
    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
    expect(mockPrisma.pipelineStageEvent.create).not.toHaveBeenCalled();
  });

  it("leaves the deal alone when the commitment is recorded as withdrawn", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue({ id: INVESTOR_ID } as never);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue({ id: ROUND_ID } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({ id: PIPELINE_ID } as never);
    mockPrisma.commitment.create.mockResolvedValue(commitment as never);

    await service.createCommitment(STARTUP_ID, { investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000, status: "withdrawn" });

    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
  });
});

describe("FundraisingService round close dates", () => {
  it("persists first and target close dates on create", async () => {
    const first = new Date("2026-09-01T00:00:00.000Z");
    const target = new Date("2026-12-01T00:00:00.000Z");
    mockPrisma.fundraisingRound.create.mockResolvedValue({ id: ROUND_ID, targetAmount: null, minimumTicketSize: null, equityOfferedPercentage: null } as never);

    await service.createRound(STARTUP_ID, { roundName: "Seed", targetAmount: 500000, currency: "USD", firstCloseDate: first, targetCloseDate: target } as never, USER_ID);

    expect(mockPrisma.fundraisingRound.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ firstCloseDate: first, targetCloseDate: target }) }));
  });
});

describe("FundraisingService.updateCommitment", () => {
  it("takes the deal off committed when the investor withdraws", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment as never);
    mockPrisma.commitment.update.mockResolvedValue({ ...commitment, status: "withdrawn" } as never);
    mockPrisma.pipeline.findUnique.mockResolvedValue({ id: PIPELINE_ID, stage: "committed" } as never);

    await service.updateCommitment(STARTUP_ID, commitment.id, { status: "withdrawn" } as never);

    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stage: "term_sheet" }) }));
  });

  it("keeps the deal committed when another live commitment remains", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment as never);
    mockPrisma.commitment.update.mockResolvedValue({ ...commitment, status: "withdrawn" } as never);
    mockPrisma.commitment.count.mockResolvedValue(1 as never);

    await service.updateCommitment(STARTUP_ID, commitment.id, { status: "withdrawn" } as never);

    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
  });

  it("puts the deal back on committed when a withdrawn commitment is reinstated", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue({ ...commitment, status: "withdrawn" } as never);
    mockPrisma.commitment.update.mockResolvedValue({ ...commitment, status: "hard_circled" } as never);
    mockPrisma.pipeline.findUnique.mockResolvedValue({ id: PIPELINE_ID, stage: "term_sheet" } as never);

    await service.updateCommitment(STARTUP_ID, commitment.id, { status: "hard_circled" } as never);

    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stage: "committed" }) }));
  });

  it("leaves the stage alone when only the amount changes", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment as never);
    mockPrisma.commitment.update.mockResolvedValue(commitment as never);

    await service.updateCommitment(STARTUP_ID, commitment.id, { amount: 75000 } as never);

    expect(mockPrisma.pipeline.update).not.toHaveBeenCalled();
    // Editing the amount alone is not a status transition, so it must not
    // appear as one on the funding chart.
    expect(mockPrisma.commitmentStatusEvent.create).not.toHaveBeenCalled();
  });

  it("records the status transition when status actually changes", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment as never);
    mockPrisma.commitment.update.mockResolvedValue({ ...commitment, status: "wired" } as never);

    await service.updateCommitment(STARTUP_ID, commitment.id, { status: "wired" } as never);

    expect(mockPrisma.commitmentStatusEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ commitmentId: commitment.id, fromStatus: "hard_circled", toStatus: "wired" }),
    }));
  });
});

function roundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUND_ID,
    startupId: STARTUP_ID,
    roundName: "Seed",
    targetAmount: new Prisma.Decimal(1_000_000),
    minimumTicketSize: null,
    equityOfferedPercentage: null,
    currency: "EUR",
    status: "active",
    firstCloseDate: null,
    targetCloseDate: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("FundraisingService.getRoundMetrics", () => {
  it("separates wired, hard-circled and soft-circled, and reports the round's own currency", async () => {
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue(roundRow() as never);
    mockPrisma.commitment.findMany.mockResolvedValue([
      { id: "c1", amount: new Prisma.Decimal(200_000), status: "wired", expectedCloseDate: null, startupInvestor: { fullName: "Ada" } },
      { id: "c2", amount: new Prisma.Decimal(100_000), status: "hard_circled", expectedCloseDate: null, startupInvestor: { fullName: "Grace" } },
      { id: "c3", amount: new Prisma.Decimal(50_000), status: "soft_circled", expectedCloseDate: null, startupInvestor: { fullName: "Alan" } },
    ] as never);
    mockPrisma.pipeline.findMany.mockResolvedValue([]);

    const metrics = await service.getRoundMetrics(STARTUP_ID, ROUND_ID);

    expect(metrics).toMatchObject({
      currency: "EUR",
      targetAmount: 1_000_000,
      wired: 200_000,
      hardCircled: 100_000,
      softCircled: 50_000,
      bankableRaised: 300_000,
      remainingGap: 700_000,
      percentToTarget: 30,
    });
  });

  it("weights only live deals, never double-counting a committed deal's exact commitment", async () => {
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue(roundRow() as never);
    mockPrisma.commitment.findMany.mockResolvedValue([]);

    await service.getRoundMetrics(STARTUP_ID, ROUND_ID);

    expect(mockPrisma.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stage: { notIn: ["committed", "passed"] } }),
      }),
    );
  });

  it("computes the weighted pipeline as expectedAmount times probability", async () => {
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue(roundRow() as never);
    mockPrisma.commitment.findMany.mockResolvedValue([]);
    mockPrisma.pipeline.findMany.mockResolvedValue([
      { expectedAmount: new Prisma.Decimal(400_000), probabilityPercentage: 50 },
      { expectedAmount: new Prisma.Decimal(100_000), probabilityPercentage: 25 },
    ] as never);

    const metrics = await service.getRoundMetrics(STARTUP_ID, ROUND_ID);

    expect(metrics.weightedPipeline).toBe(400_000 * 0.5 + 100_000 * 0.25);
  });

  it("counts days to close down to targetCloseDate, falling back to firstCloseDate", async () => {
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue(
      roundRow({ targetCloseDate: null, firstCloseDate: inTenDays }) as never,
    );
    mockPrisma.commitment.findMany.mockResolvedValue([]);
    mockPrisma.pipeline.findMany.mockResolvedValue([]);

    const metrics = await service.getRoundMetrics(STARTUP_ID, ROUND_ID);

    expect(metrics.daysToClose).toBe(10);
  });

  it("reports null days to close when neither close date is set", async () => {
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue(roundRow() as never);
    mockPrisma.commitment.findMany.mockResolvedValue([]);
    mockPrisma.pipeline.findMany.mockResolvedValue([]);

    const metrics = await service.getRoundMetrics(STARTUP_ID, ROUND_ID);

    expect(metrics.daysToClose).toBeNull();
  });

  it("flags a commitment whose expected close date has passed without it being wired", async () => {
    const overdue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue(roundRow() as never);
    mockPrisma.commitment.findMany.mockResolvedValue([
      { id: "c1", amount: new Prisma.Decimal(50_000), status: "soft_circled", expectedCloseDate: overdue, startupInvestor: { fullName: "Ada" } },
    ] as never);
    mockPrisma.pipeline.findMany.mockResolvedValue([]);

    const metrics = await service.getRoundMetrics(STARTUP_ID, ROUND_ID);

    expect(metrics.atRiskCommitments).toEqual([
      expect.objectContaining({ id: "c1", investorName: "Ada", daysOverdue: 5 }),
    ]);
  });

  it("does not flag a wired or withdrawn commitment even with a passed close date", async () => {
    const overdue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue(roundRow() as never);
    mockPrisma.commitment.findMany.mockResolvedValue([
      { id: "c1", amount: new Prisma.Decimal(50_000), status: "wired", expectedCloseDate: overdue, startupInvestor: { fullName: "Ada" } },
      { id: "c2", amount: new Prisma.Decimal(50_000), status: "withdrawn", expectedCloseDate: overdue, startupInvestor: { fullName: "Grace" } },
    ] as never);
    mockPrisma.pipeline.findMany.mockResolvedValue([]);

    const metrics = await service.getRoundMetrics(STARTUP_ID, ROUND_ID);

    expect(metrics.atRiskCommitments).toEqual([]);
  });
});

describe("FundraisingService.getFundingHistory", () => {
  it("returns real status transitions oldest first, in the commitment's amount and investor", async () => {
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue(roundRow() as never);
    mockPrisma.commitmentStatusEvent.findMany.mockResolvedValue([
      {
        id: "e1",
        commitmentId: "c1",
        fromStatus: null,
        toStatus: "soft_circled",
        createdAt: new Date("2026-01-05"),
        commitment: { amount: new Prisma.Decimal(50_000), startupInvestor: { fullName: "Ada" } },
      },
      {
        id: "e2",
        commitmentId: "c1",
        fromStatus: "soft_circled",
        toStatus: "wired",
        createdAt: new Date("2026-02-10"),
        commitment: { amount: new Prisma.Decimal(50_000), startupInvestor: { fullName: "Ada" } },
      },
    ] as never);

    const history = await service.getFundingHistory(STARTUP_ID, ROUND_ID);

    expect(mockPrisma.commitmentStatusEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: STARTUP_ID, commitment: { roundId: ROUND_ID } },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(history).toEqual([
      expect.objectContaining({ id: "e1", investorName: "Ada", fromStatus: null, toStatus: "soft_circled", amount: 50_000 }),
      expect.objectContaining({ id: "e2", fromStatus: "soft_circled", toStatus: "wired" }),
    ]);
  });
});

describe("FundraisingService.deleteCommitment", () => {
  it("takes the deal off committed, since nothing records the money any more", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment as never);
    mockPrisma.pipeline.findUnique.mockResolvedValue({ id: PIPELINE_ID, stage: "committed" } as never);

    await service.deleteCommitment(STARTUP_ID, commitment.id);

    expect(mockPrisma.commitment.delete).toHaveBeenCalledWith({ where: { id: commitment.id } });
    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stage: "term_sheet" }) }));
  });
});
