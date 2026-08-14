import { notifyOverdueAndDueTodayTasks } from "../../src/jobs/task-notifications";

jest.mock("../../src/db/prisma", () => ({
  prisma: { task: { findMany: jest.fn() } },
}));

jest.mock("../../src/services/notification.service", () => ({
  notificationService: { notifyTaskOverdue: jest.fn(), notifyTaskDueToday: jest.fn() },
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
});
