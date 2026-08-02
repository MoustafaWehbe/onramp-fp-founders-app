import { Prisma } from "@prisma/client";
import { PipelineService } from "../../src/services/pipeline.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupInvestor: { findUnique: jest.fn() },
    pipeline: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    commitment: { count: jest.fn() },
  },
}));

import { prisma } from "../../src/db/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new PipelineService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_STARTUP = "00000000-0000-0000-0000-000000000099";
const CONTACT_ID = "00000000-0000-0000-0000-000000000002";
const PIPELINE_ID = "00000000-0000-0000-0000-000000000003";

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
    startupInvestorId: CONTACT_ID,
    stage: "sourced",
    expectedAmount: new Prisma.Decimal(250000),
    probabilityPercentage: 40,
    createdAt: new Date("2026-01-02"),
    updatedAt: new Date("2026-01-03"),
    startupInvestor: CONTACT,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
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
      where: { startupId: STARTUP_ID, stage: "due_diligence" },
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
