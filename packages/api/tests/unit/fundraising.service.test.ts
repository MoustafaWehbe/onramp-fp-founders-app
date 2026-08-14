import { Prisma } from "@prisma/client";
import { FundraisingService } from "../../src/services/fundraising.service";

jest.mock("../../src/db/prisma", () => {
  const client: Record<string, unknown> = {
    startupInvestor: { findUnique: jest.fn() },
    fundraisingRound: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    pipeline: { findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
    pipelineStageEvent: { create: jest.fn() },
    commitment: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
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

const investor = { id: INVESTOR_ID, startupId: STARTUP_ID, fullName: "Ada", email: null, ventureFirm: null, investorType: null, sectorFocus: null, investmentStagePreference: null, linkedinUrl: null, notes: null, source: null, createdAt: new Date(), updatedAt: new Date() };
const commitment = { id: "00000000-0000-0000-0000-000000000005", startupId: STARTUP_ID, startupInvestorId: INVESTOR_ID, pipelineId: PIPELINE_ID, roundId: ROUND_ID, amount: new Prisma.Decimal(50000), status: "hard_circled", expectedCloseDate: null, createdAt: new Date(), updatedAt: new Date(), startupInvestor: investor };

beforeEach(() => jest.clearAllMocks());

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
  });

  // The board and the round page must agree whichever one the founder used.
  it("moves the linked deal to committed and records the stage change", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue({ id: INVESTOR_ID } as never);
    mockPrisma.fundraisingRound.findUnique.mockResolvedValue({ id: ROUND_ID } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({ id: PIPELINE_ID } as never);
    mockPrisma.pipeline.findUnique.mockResolvedValue({ id: PIPELINE_ID, stage: "term_sheet" } as never);
    mockPrisma.commitment.create.mockResolvedValue(commitment as never);

    await service.createCommitment(STARTUP_ID, { investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000 });

    expect(mockPrisma.pipeline.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PIPELINE_ID }, data: expect.objectContaining({ stage: "committed" }) }));
    expect(mockPrisma.pipelineStageEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fromStage: "term_sheet", toStage: "committed" }) }));
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

    await service.createRound(STARTUP_ID, { roundName: "Seed", targetAmount: 500000, currency: "USD", firstCloseDate: first, targetCloseDate: target } as never);

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
