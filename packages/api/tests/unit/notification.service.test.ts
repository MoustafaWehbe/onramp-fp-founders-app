import { NotificationService } from "../../src/services/notification.service";

jest.mock("../../src/db/prisma", () => {
  // $transaction just invokes the callback with this same mock, so every
  // dedup method's tx.notification.findFirst/create calls land on the exact
  // jest.fn()s below assertions against prisma.notification.* keep working
  // unchanged whether or not the method under test wraps its writes in a
  // withDedupeLock transaction.
  const prismaMock: {
    notification: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; deleteMany: jest.Mock; count: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  } = {
    notification: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    $executeRaw: jest.fn(),
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prismaMock)),
  };
  return { prisma: prismaMock };
});

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

async function expectSwallowedFailure(operation: () => Promise<void>): Promise<void> {
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(operation()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  } finally {
    errorSpy.mockRestore();
  }
}

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

    await expectSwallowedFailure(() => service.notifyFollowupDue(input));
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

    await expectSwallowedFailure(() => service.clearFollowupNotifications([LOG_ID]));
  });
});

describe("NotificationService.notifyTaskOverdue / notifyTaskDueToday", () => {
  const TASK_ID = "00000000-0000-0000-0000-000000000005";
  const input = {
    userId: USER_ID,
    startupId: STARTUP_ID,
    taskId: TASK_ID,
    title: "Send follow-up deck",
    dueDate: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("creates a task_overdue notification and publishes it when none exists yet", async () => {
    (mockPrisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue({
      id: "notif-1",
      type: "task_overdue",
      title: "Task overdue: Send follow-up deck",
      body: "Was due 2026-08-01.",
    });

    await service.notifyTaskOverdue(input);

    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          startupId: STARTUP_ID,
          type: "task_overdue",
          entityType: "task",
          entityId: TASK_ID,
        }),
      }),
    );
    expect(mockBus.publish).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ type: "notification.created" }),
    );
  });

  it("does nothing when this task already has a pending task_overdue notification", async () => {
    (mockPrisma.notification.findFirst as jest.Mock).mockResolvedValue({ id: "notif-1" });

    await service.notifyTaskOverdue(input);

    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });

  it("creates a distinct task_due_today notification, not deduped against task_overdue", async () => {
    (mockPrisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue({
      id: "notif-2",
      type: "task_due_today",
    });

    await service.notifyTaskDueToday(input);

    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "task_due_today" }),
      }),
    );
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "task_due_today" }) }),
    );
  });

  it("swallows a database failure rather than throwing", async () => {
    (mockPrisma.notification.findFirst as jest.Mock).mockRejectedValue(new Error("db down"));

    await expectSwallowedFailure(() => service.notifyTaskOverdue(input));
  });
});

describe("NotificationService.clearTaskNotifications", () => {
  const TASK_ID = "00000000-0000-0000-0000-000000000005";
  const OTHER_TASK_ID = "00000000-0000-0000-0000-000000000006";

  it("does nothing for an empty list", async () => {
    await service.clearTaskNotifications([]);

    expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
  });

  it("deletes both overdue and due-today notifications for the given tasks", async () => {
    (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([
      { id: "notif-1", userId: USER_ID },
    ]);

    await service.clearTaskNotifications([TASK_ID, OTHER_TASK_ID]);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: { in: ["task_overdue", "task_due_today"] },
          entityType: "task",
          entityId: { in: [TASK_ID, OTHER_TASK_ID] },
        }),
      }),
    );
    expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["notif-1"] } },
    });
    expect(mockBus.publish).toHaveBeenCalledWith(USER_ID, { type: "notifications.changed" });
  });

  it("swallows a database failure rather than throwing", async () => {
    (mockPrisma.notification.findMany as jest.Mock).mockRejectedValue(new Error("db down"));

    await expectSwallowedFailure(() => service.clearTaskNotifications([TASK_ID]));
  });
});

describe("NotificationService.list", () => {
  beforeEach(() => {
    (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);
  });

  it("scopes both the page and unreadCount to startupId when given, not just the page", async () => {
    await service.list(USER_ID, { limit: 30, unreadOnly: false, startupId: STARTUP_ID });

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, startupId: STARTUP_ID } }),
    );
    // Without this, a workspace whose notifications fell outside the page
    // window (or off it entirely, filtered client-side) reported someone
    // else's unread count instead of its own.
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, startupId: STARTUP_ID, readAt: null },
    });
  });

  it("omits the startupId filter entirely when none is given, not just a falsy one", async () => {
    await service.list(USER_ID, { limit: 30, unreadOnly: false });

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    );
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({ where: { userId: USER_ID, readAt: null } });
  });

  it("combines the startupId scope with unreadOnly", async () => {
    await service.list(USER_ID, { limit: 30, unreadOnly: true, startupId: STARTUP_ID });

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, startupId: STARTUP_ID, readAt: null } }),
    );
  });
});
