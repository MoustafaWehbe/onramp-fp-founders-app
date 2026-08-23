import { notifyOverdueAndDueTodayTasks } from "../../src/jobs/task-notifications";

jest.mock("../../src/db/prisma", () => ({
  prisma: { task: { findMany: jest.fn() }, notification: { findMany: jest.fn() } },
}));

jest.mock("../../src/services/notification.service", () => ({
  notificationService: { notifyTaskOverdue: jest.fn(), notifyTaskDueToday: jest.fn() },
  NOTIFICATION_TYPES: { TASK_OVERDUE: "task_overdue", TASK_DUE_TODAY: "task_due_today" },
}));

import { prisma } from "../../src/db/prisma";
import { notificationService } from "../../src/services/notification.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockOverdue = notificationService.notifyTaskOverdue as jest.Mock;
const mockDueToday = notificationService.notifyTaskDueToday as jest.Mock;

const USER_ID = "00000000-0000-0000-0000-000000000001";
const STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const TASK_ID = "00000000-0000-0000-0000-000000000003";

beforeEach(() => {
  jest.clearAllMocks();
  // Batched "already notified" pre-check the job runs before actually
  // notifying; empty by default so existing tests' tasks are treated as due.
  (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
});

describe("notifyOverdueAndDueTodayTasks", () => {
  it("only asks for open tasks due on or before the end of today", async () => {
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([]);

    await notifyOverdueAndDueTodayTasks();

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "open", dueDate: { not: null, lte: expect.any(Date) } },
      }),
    );
  });

  it("notifies the assignee as overdue when the due date has passed", async () => {
    const dueDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        id: TASK_ID,
        startupId: STARTUP_ID,
        title: "Send follow-up deck",
        dueDate,
        assignee: { userId: USER_ID },
      },
    ]);

    await notifyOverdueAndDueTodayTasks();

    expect(mockOverdue).toHaveBeenCalledWith({
      userId: USER_ID,
      startupId: STARTUP_ID,
      taskId: TASK_ID,
      title: "Send follow-up deck",
      dueDate,
    });
    expect(mockDueToday).not.toHaveBeenCalled();
  });

  it("notifies the assignee as due-today when the due date has not passed yet", async () => {
    const dueDate = new Date(Date.now() + 60 * 60 * 1000);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        id: TASK_ID,
        startupId: STARTUP_ID,
        title: "Send follow-up deck",
        dueDate,
        assignee: { userId: USER_ID },
      },
    ]);

    await notifyOverdueAndDueTodayTasks();

    expect(mockDueToday).toHaveBeenCalledWith({
      userId: USER_ID,
      startupId: STARTUP_ID,
      taskId: TASK_ID,
      title: "Send follow-up deck",
      dueDate,
    });
    expect(mockOverdue).not.toHaveBeenCalled();
  });

  it("skips a task with no assignee", async () => {
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        id: TASK_ID,
        startupId: STARTUP_ID,
        title: "Unassigned",
        dueDate: new Date(),
        assignee: null,
      },
    ]);

    await notifyOverdueAndDueTodayTasks();

    expect(mockOverdue).not.toHaveBeenCalled();
    expect(mockDueToday).not.toHaveBeenCalled();
  });

  it("skips a task whose assignee is a pending invite with no account yet", async () => {
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        id: TASK_ID,
        startupId: STARTUP_ID,
        title: "Pending invite",
        dueDate: new Date(),
        assignee: { userId: null },
      },
    ]);

    await notifyOverdueAndDueTodayTasks();

    expect(mockOverdue).not.toHaveBeenCalled();
    expect(mockDueToday).not.toHaveBeenCalled();
  });

  it("skips a task the batched pre-check already knows was notified, without calling notifyTaskOverdue at all", async () => {
    const dueDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      { id: TASK_ID, startupId: STARTUP_ID, title: "Send follow-up deck", dueDate, assignee: { userId: USER_ID } },
    ]);
    (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([{ type: "task_overdue", entityId: TASK_ID }]);

    await notifyOverdueAndDueTodayTasks();

    expect(mockOverdue).not.toHaveBeenCalled();
  });

  it("does not let an overdue cooldown row suppress a distinct due-today notification for the same task", async () => {
    // A task that was overdue and got its task_overdue notification, then
    // had its due date pushed to today, still needs its own task_due_today
    // notification — the two are tracked as distinct (type, entity) pairs.
    const dueDate = new Date(Date.now() + 60 * 60 * 1000);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([
      { id: TASK_ID, startupId: STARTUP_ID, title: "Send follow-up deck", dueDate, assignee: { userId: USER_ID } },
    ]);
    (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([{ type: "task_overdue", entityId: TASK_ID }]);

    await notifyOverdueAndDueTodayTasks();

    expect(mockDueToday).toHaveBeenCalledWith(expect.objectContaining({ taskId: TASK_ID }));
  });

  it("does not query the notification table at all when there are no candidate tasks", async () => {
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([]);

    await notifyOverdueAndDueTodayTasks();

    expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
  });
});
