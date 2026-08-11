import { notifyOverdueFollowups } from "../../src/jobs/followup-notifications";

jest.mock("../../src/db/prisma", () => ({
  prisma: { interactionLog: { findMany: jest.fn() } },
}));

jest.mock("../../src/services/notification.service", () => ({
  notificationService: { notifyFollowupDue: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { notificationService } from "../../src/services/notification.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockNotify = notificationService.notifyFollowupDue as jest.Mock;

const USER_ID = "00000000-0000-0000-0000-000000000001";
const STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const LOG_ID = "00000000-0000-0000-0000-000000000003";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("notifyOverdueFollowups", () => {
  it("only asks for logs with an open, past-due follow-up", async () => {
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    await notifyOverdueFollowups();

    expect(mockPrisma.interactionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          followupCompletedAt: null,
          nextFollowupDate: { not: null, lt: expect.any(Date) },
        },
      }),
    );
  });

  it("notifies the log's creator for each overdue follow-up found", async () => {
    const dueDate = new Date("2026-08-01T00:00:00.000Z");
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([
      {
        id: LOG_ID,
        createdBy: USER_ID,
        nextFollowupDate: dueDate,
        startupInvestor: { fullName: "Ada Lovelace", startupId: STARTUP_ID },
      },
    ]);

    await notifyOverdueFollowups();

    expect(mockNotify).toHaveBeenCalledWith({
      userId: USER_ID,
      startupId: STARTUP_ID,
      logId: LOG_ID,
      investorName: "Ada Lovelace",
      dueDate,
    });
  });

  it("does nothing when there are no overdue follow-ups", async () => {
    (mockPrisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    await notifyOverdueFollowups();

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
