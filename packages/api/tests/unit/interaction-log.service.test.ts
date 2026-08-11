import { Prisma } from "@prisma/client";
import { InteractionLogService } from "../../src/services/interaction-log.service";

// Clearing overdue-follow-up notifications is a side effect of closing
// follow-ups; these tests only care about the follow-up bookkeeping itself.
jest.mock("../../src/services/notification.service", () => ({
  notificationService: { clearFollowupNotifications: jest.fn() },
}));

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupInvestor: {
      findUnique: jest.fn(),
    },
    pipeline: {
      findUnique: jest.fn(),
    },
    interactionLog: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { prisma } from "../../src/db/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new InteractionLogService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_STARTUP_ID = "00000000-0000-0000-0000-000000000099";
const CONTACT_ID = "00000000-0000-0000-0000-000000000002";
const OTHER_CONTACT_ID = "00000000-0000-0000-0000-000000000003";
const PIPELINE_ID = "00000000-0000-0000-0000-000000000004";
const OTHER_PIPELINE_ID = "00000000-0000-0000-0000-000000000005";
const LOG_ID = "00000000-0000-0000-0000-000000000006";
const USER_ID = "00000000-0000-0000-0000-000000000007";

const DEFAULT_QUERY = { page: 1, limit: 20 };

beforeEach(() => {
  jest.clearAllMocks();
  // Creating a log closes the follow-ups it satisfies; tests that don't care
  // about that still need the sweep to resolve.
  (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);
  (mockPrisma.interactionLog.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
});

describe("InteractionLogService.createLog", () => {
  it("creates a log scoped through the startup-investor composite key", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.interactionLog.create as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      pipelineId: null,
      createdBy: USER_ID,
      type: "call",
      subject: null,
      description: null,
      interactionDate: new Date("2025-01-15T10:00:00.000Z"),
      nextFollowupDate: null,
      createdAt: new Date(),
    });

    const result = await service.createLog(
      STARTUP_ID,
      {
        investorId: CONTACT_ID,
        type: "call",
        interactionDate: new Date("2025-01-15T10:00:00.000Z"),
      } as never,
      USER_ID,
    );

    expect(mockPrisma.startupInvestor.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId_id: { startupId: STARTUP_ID, id: CONTACT_ID } },
      }),
    );
    expect(result.data).toMatchObject({ id: LOG_ID, investorId: CONTACT_ID, type: "call" });
  });

  it("sets createdBy from userId, never from the body", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.interactionLog.create as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      pipelineId: null,
      createdBy: USER_ID,
      type: "note",
      subject: null,
      description: null,
      interactionDate: new Date(),
      nextFollowupDate: null,
      createdAt: new Date(),
    });

    await service.createLog(
      STARTUP_ID,
      {
        investorId: CONTACT_ID,
        type: "note",
        interactionDate: new Date(),
      } as never,
      USER_ID,
    );

    const createData = (mockPrisma.interactionLog.create as jest.Mock).mock.calls[0][0].data;
    expect(createData.createdBy).toBe(USER_ID);
  });

  it("throws INVESTOR_NOT_FOUND for a cross-tenant investorId", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createLog(
        STARTUP_ID,
        {
          investorId: OTHER_CONTACT_ID,
          type: "call",
          interactionDate: new Date(),
        } as never,
        USER_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: "INVESTOR_NOT_FOUND" });

    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  it("verifies pipelineId belongs to the same contact", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      startupInvestorId: OTHER_CONTACT_ID,
    });

    await expect(
      service.createLog(
        STARTUP_ID,
        {
          investorId: CONTACT_ID,
          pipelineId: PIPELINE_ID,
          type: "call",
          interactionDate: new Date(),
        } as never,
        USER_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "PIPELINE_MISMATCH" });
  });

  it("accepts a pipelineId that belongs to the same contact", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      startupInvestorId: CONTACT_ID,
    });
    (mockPrisma.interactionLog.create as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      pipelineId: PIPELINE_ID,
      createdBy: USER_ID,
      type: "call",
      subject: null,
      description: null,
      interactionDate: new Date(),
      nextFollowupDate: null,
      createdAt: new Date(),
    });

    const result = await service.createLog(
      STARTUP_ID,
      {
        investorId: CONTACT_ID,
        pipelineId: PIPELINE_ID,
        type: "call",
        interactionDate: new Date(),
      } as never,
      USER_ID,
    );

    expect(result.data.pipelineId).toBe(PIPELINE_ID);
  });

  it("translates a P2003 FK violation into PIPELINE_MISMATCH", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.interactionLog.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
        code: "P2003",
        clientVersion: "5.22.0",
      }),
    );

    await expect(
      service.createLog(
        STARTUP_ID,
        {
          investorId: CONTACT_ID,
          pipelineId: PIPELINE_ID,
          type: "call",
          interactionDate: new Date(),
        } as never,
        USER_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "PIPELINE_MISMATCH" });
  });
});

describe("InteractionLogService.listLogs", () => {
  it("scopes through the startup's contacts", async () => {
    (mockPrisma.interactionLog.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    await service.listLogs(STARTUP_ID, DEFAULT_QUERY as never);

    expect(mockPrisma.interactionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupInvestor: { startupId: STARTUP_ID } },
      }),
    );
  });

  it("returns pagination meta", async () => {
    (mockPrisma.interactionLog.count as jest.Mock).mockResolvedValue(25);
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listLogs(STARTUP_ID, { page: 2, limit: 20 } as never);

    expect(result.meta).toEqual({ page: 2, limit: 20, total: 25, totalPages: 2 });
  });
});

describe("InteractionLogService.getLog", () => {
  it("returns the log when it belongs to the startup", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      pipelineId: null,
      createdBy: USER_ID,
      type: "call",
      subject: null,
      description: null,
      interactionDate: new Date(),
      nextFollowupDate: null,
      createdAt: new Date(),
      startupInvestor: { startupId: STARTUP_ID },
    });

    const result = await service.getLog(STARTUP_ID, LOG_ID);

    expect(result.data.id).toBe(LOG_ID);
  });

  it("throws LOG_NOT_FOUND for a cross-tenant log", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      pipelineId: null,
      createdBy: USER_ID,
      type: "call",
      subject: null,
      description: null,
      interactionDate: new Date(),
      nextFollowupDate: null,
      createdAt: new Date(),
      startupInvestor: { startupId: OTHER_STARTUP_ID },
    });

    await expect(service.getLog(STARTUP_ID, LOG_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "LOG_NOT_FOUND",
    });
  });

  it("throws LOG_NOT_FOUND for a non-existent log", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getLog(STARTUP_ID, LOG_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "LOG_NOT_FOUND",
    });
  });
});

describe("InteractionLogService follow-up completion", () => {
  const LOGGED_AT = new Date("2026-08-09T10:00:00.000Z");

  function createdLog(overrides: Record<string, unknown> = {}) {
    return {
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      pipelineId: null,
      createdBy: USER_ID,
      type: "call",
      subject: null,
      description: null,
      interactionDate: LOGGED_AT,
      nextFollowupDate: null,
      followupCompletedAt: null,
      createdAt: LOGGED_AT,
      ...overrides,
    };
  }

  beforeEach(() => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.interactionLog.create as jest.Mock).mockResolvedValue(createdLog());
  });

  it("closes only the follow-ups the new interaction actually satisfies", async () => {
    const CLOSED_LOG_ID = "00000000-0000-0000-0000-000000000008";
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([{ id: CLOSED_LOG_ID }]);

    await service.createLog(
      STARTUP_ID,
      { investorId: CONTACT_ID, type: "call", interactionDate: LOGGED_AT } as never,
      USER_ID,
    );

    expect(mockPrisma.interactionLog.findMany).toHaveBeenCalledWith({
      where: {
        startupInvestorId: CONTACT_ID,
        id: { not: LOG_ID },
        followupCompletedAt: null,
        // A reminder set for next month must survive a note logged today.
        nextFollowupDate: { not: null, lte: LOGGED_AT },
      },
      select: { id: true },
    });
    expect(mockPrisma.interactionLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [CLOSED_LOG_ID] } },
      data: { followupCompletedAt: LOGGED_AT },
    });
  });

  it("never closes the follow-up the new log itself is setting", async () => {
    await service.createLog(
      STARTUP_ID,
      {
        investorId: CONTACT_ID,
        type: "call",
        interactionDate: LOGGED_AT,
        nextFollowupDate: new Date("2026-08-01T10:00:00.000Z"),
      } as never,
      USER_ID,
    );

    const [{ where }] = (mockPrisma.interactionLog.findMany as jest.Mock).mock.calls[0];
    expect(where.id).toEqual({ not: LOG_ID });
  });

  it("exposes followupCompletedAt on the serialized log", async () => {
    const completedAt = new Date("2026-08-09T12:00:00.000Z");
    (mockPrisma.interactionLog.create as jest.Mock).mockResolvedValue(
      createdLog({ followupCompletedAt: completedAt }),
    );

    const result = await service.createLog(
      STARTUP_ID,
      { investorId: CONTACT_ID, type: "call", interactionDate: LOGGED_AT } as never,
      USER_ID,
    );

    expect(result.data.followupCompletedAt).toEqual(completedAt);
  });

  it("reopens a follow-up when it is rescheduled", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      startupInvestor: { startupId: STARTUP_ID },
    });
    (mockPrisma.interactionLog.update as jest.Mock).mockResolvedValue(createdLog());

    await service.updateLog(STARTUP_ID, LOG_ID, {
      nextFollowupDate: new Date("2026-09-01T10:00:00.000Z"),
    } as never);

    expect(mockPrisma.interactionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ followupCompletedAt: null }),
      }),
    );
  });

  it("marks a follow-up done without touching its date", async () => {
    const doneAt = new Date("2026-08-09T15:00:00.000Z");
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      startupInvestor: { startupId: STARTUP_ID },
    });
    (mockPrisma.interactionLog.update as jest.Mock).mockResolvedValue(
      createdLog({ followupCompletedAt: doneAt }),
    );

    await service.updateLog(STARTUP_ID, LOG_ID, { followupCompletedAt: doneAt } as never);

    const [{ data }] = (mockPrisma.interactionLog.update as jest.Mock).mock.calls[0];
    expect(data.followupCompletedAt).toEqual(doneAt);
    expect(data).not.toHaveProperty("nextFollowupDate");
  });
});

describe("InteractionLogService.updateLog", () => {
  it("updates the log when it belongs to the startup", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      startupInvestor: { startupId: STARTUP_ID },
    });
    (mockPrisma.interactionLog.update as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      pipelineId: null,
      createdBy: USER_ID,
      type: "meeting",
      subject: null,
      description: null,
      interactionDate: new Date(),
      nextFollowupDate: null,
      createdAt: new Date(),
    });

    const result = await service.updateLog(STARTUP_ID, LOG_ID, { type: "meeting" } as never);

    expect(result.data.type).toBe("meeting");
  });

  it("throws LOG_NOT_FOUND for a cross-tenant log", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      startupInvestor: { startupId: OTHER_STARTUP_ID },
    });

    await expect(
      service.updateLog(STARTUP_ID, LOG_ID, { type: "meeting" } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "LOG_NOT_FOUND" });
  });

  it("verifies pipelineId on update", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestorId: CONTACT_ID,
      startupInvestor: { startupId: STARTUP_ID },
    });
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      startupInvestorId: OTHER_CONTACT_ID,
    });

    await expect(
      service.updateLog(STARTUP_ID, LOG_ID, { pipelineId: PIPELINE_ID } as never),
    ).rejects.toMatchObject({ statusCode: 422, code: "PIPELINE_MISMATCH" });
  });
});

describe("InteractionLogService.deleteLog", () => {
  it("deletes the log when it belongs to the startup", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestor: { startupId: STARTUP_ID },
    });
    (mockPrisma.interactionLog.delete as jest.Mock).mockResolvedValue({});

    await service.deleteLog(STARTUP_ID, LOG_ID);

    expect(mockPrisma.interactionLog.delete).toHaveBeenCalledWith({ where: { id: LOG_ID } });
  });

  it("throws LOG_NOT_FOUND for a cross-tenant log", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue({
      id: LOG_ID,
      startupInvestor: { startupId: OTHER_STARTUP_ID },
    });

    await expect(service.deleteLog(STARTUP_ID, LOG_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "LOG_NOT_FOUND",
    });

    expect(mockPrisma.interactionLog.delete).not.toHaveBeenCalled();
  });

  it("throws LOG_NOT_FOUND for a non-existent log", async () => {
    (mockPrisma.interactionLog.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.deleteLog(STARTUP_ID, LOG_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "LOG_NOT_FOUND",
    });
  });
});

describe("InteractionLogService.listLogsByInvestor", () => {
  it("resolves the investor through the startup composite key", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.interactionLog.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    await service.listLogsByInvestor(STARTUP_ID, CONTACT_ID, DEFAULT_QUERY as never);

    expect(mockPrisma.startupInvestor.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId_id: { startupId: STARTUP_ID, id: CONTACT_ID } },
      }),
    );
    expect(mockPrisma.interactionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { startupInvestorId: CONTACT_ID } }),
    );
  });

  it("throws INVESTOR_NOT_FOUND for a cross-tenant investor", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.listLogsByInvestor(STARTUP_ID, OTHER_CONTACT_ID, DEFAULT_QUERY as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "INVESTOR_NOT_FOUND" });
  });

  it("returns pagination meta", async () => {
    (mockPrisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    (mockPrisma.interactionLog.count as jest.Mock).mockResolvedValue(5);
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listLogsByInvestor(STARTUP_ID, CONTACT_ID, DEFAULT_QUERY as never);

    expect(result.meta).toEqual({ page: 1, limit: 20, total: 5, totalPages: 1 });
  });
});

describe("InteractionLogService.listLogsByPipeline", () => {
  it("resolves the pipeline through the startup composite key", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      startupInvestorId: CONTACT_ID,
    });
    (mockPrisma.interactionLog.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    await service.listLogsByPipeline(STARTUP_ID, PIPELINE_ID, DEFAULT_QUERY as never);

    expect(mockPrisma.pipeline.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId_id: { startupId: STARTUP_ID, id: PIPELINE_ID } },
      }),
    );
    expect(mockPrisma.interactionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: PIPELINE_ID, startupInvestorId: CONTACT_ID },
      }),
    );
  });

  it("throws PIPELINE_NOT_FOUND for a cross-tenant pipeline", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.listLogsByPipeline(STARTUP_ID, OTHER_PIPELINE_ID, DEFAULT_QUERY as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "PIPELINE_NOT_FOUND" });
  });

  it("returns pagination meta", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({
      id: PIPELINE_ID,
      startupInvestorId: CONTACT_ID,
    });
    (mockPrisma.interactionLog.count as jest.Mock).mockResolvedValue(3);
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listLogsByPipeline(STARTUP_ID, PIPELINE_ID, DEFAULT_QUERY as never);

    expect(result.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
  });
});