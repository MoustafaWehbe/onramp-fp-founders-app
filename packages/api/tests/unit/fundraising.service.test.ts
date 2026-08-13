import { Prisma } from "@prisma/client";
import { FundraisingService } from "../../src/services/fundraising.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupInvestor: { findUnique: jest.fn() },
    fundraisingRound: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    pipeline: { findFirst: jest.fn(), count: jest.fn() },
    commitment: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));

import { prisma } from "../../src/db/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new FundraisingService();
const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const INVESTOR_ID = "00000000-0000-0000-0000-000000000002";
const ROUND_ID = "00000000-0000-0000-0000-000000000003";
const PIPELINE_ID = "00000000-0000-0000-0000-000000000004";

const investor = { id: INVESTOR_ID, startupId: STARTUP_ID, fullName: "Ada", email: null, ventureFirm: null, investorType: null, sectorFocus: null, investmentStagePreference: null, linkedinUrl: null, notes: null, source: null, createdAt: new Date(), updatedAt: new Date() };
const commitment = { id: "00000000-0000-0000-0000-000000000005", startupId: STARTUP_ID, startupInvestorId: INVESTOR_ID, pipelineId: PIPELINE_ID, roundId: ROUND_ID, amount: new Prisma.Decimal(50000), status: "confirmed", expectedCloseDate: null, createdAt: new Date(), updatedAt: new Date(), startupInvestor: investor };

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

    const result = await service.createCommitment(STARTUP_ID, { investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000, status: "confirmed" });

    expect(result).toMatchObject({ investorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID, amount: 50000, investor });
    expect(mockPrisma.commitment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ startupId: STARTUP_ID, startupInvestorId: INVESTOR_ID, roundId: ROUND_ID, pipelineId: PIPELINE_ID }) }));
  });
});
