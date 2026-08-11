import { NotificationService } from "../../src/services/notification.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    notification: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("../../src/events/notification-bus", () => ({
  notificationBus: { publish: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { notificationBus } from "../../src/events/notification-bus";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockBus = notificationBus as jest.Mocked<typeof notificationBus>;
const service = new NotificationService();

const USER_ID = "00000000-0000-0000-0000-000000000001";
const STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const LOG_ID = "00000000-0000-0000-0000-000000000003";
const OTHER_LOG_ID = "00000000-0000-0000-0000-000000000004";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NotificationService.notifyFollowupDue", () => {
  const input = {
    userId: USER_ID,
    startupId: STARTUP_ID,
    logId: LOG_ID,
    investorName: "Ada Lovelace",
    dueDate: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("creates a notification and publishes it when none exists yet", async () => {
    (mockPrisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue({
      id: "notif-1",
      type: "followup_due",
      title: "Follow-up with Ada Lovelace is overdue",
      body: "You planned to follow up by 2026-08-01.",
    });

    await service.notifyFollowupDue(input);

    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          startupId: STARTUP_ID,
          type: "followup_due",
          entityType: "interaction_log",
          entityId: LOG_ID,
        }),
      }),
    );
    expect(mockBus.publish).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ type: "notification.created" }),
    );
  });

  it("does nothing when this log already has a pending notification", async () => {
    (mockPrisma.notification.findFirst as jest.Mock).mockResolvedValue({ id: "notif-1" });

    await service.notifyFollowupDue(input);

    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    expect(mockBus.publish).not.toHaveBeenCalled();
  });

  it("swallows a database failure rather than throwing", async () => {
    (mockPrisma.notification.findFirst as jest.Mock).mockRejectedValue(new Error("db down"));

    await expect(service.notifyFollowupDue(input)).resolves.toBeUndefined();
  });
});

describe("NotificationService.clearFollowupNotifications", () => {
  it("does nothing for an empty list", async () => {
    await service.clearFollowupNotifications([]);

    expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
  });

  it("deletes matching notifications and publishes to each affected user once", async () => {
    (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([
      { id: "notif-1", userId: USER_ID },
      { id: "notif-2", userId: "other-user" },
    ]);

    await service.clearFollowupNotifications([LOG_ID, OTHER_LOG_ID]);

    expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["notif-1", "notif-2"] } },
    });
    expect(mockBus.publish).toHaveBeenCalledTimes(2);
    expect(mockBus.publish).toHaveBeenCalledWith(USER_ID, { type: "notifications.changed" });
    expect(mockBus.publish).toHaveBeenCalledWith("other-user", { type: "notifications.changed" });
  });

  it("skips the delete and publish when nothing matches", async () => {
    (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);

    await service.clearFollowupNotifications([LOG_ID]);

    expect(mockPrisma.notification.deleteMany).not.toHaveBeenCalled();
    expect(mockBus.publish).not.toHaveBeenCalled();
  });

  it("swallows a database failure rather than throwing", async () => {
    (mockPrisma.notification.findMany as jest.Mock).mockRejectedValue(new Error("db down"));

    await expect(service.clearFollowupNotifications([LOG_ID])).resolves.toBeUndefined();
  });
});
