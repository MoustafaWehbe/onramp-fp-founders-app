import { TaskService } from "../../src/services/task.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    pipeline: { findUnique: jest.fn() },
    startupMember: { findUnique: jest.fn() },
    task: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("../../src/services/notification.service", () => ({
  notificationService: { notifyTaskAssigned: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { notificationService } from "../../src/services/notification.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockNotifyAssigned = notificationService.notifyTaskAssigned as jest.Mock;
const service = new TaskService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_STARTUP = "00000000-0000-0000-0000-000000000099";
const PIPELINE_ID = "00000000-0000-0000-0000-000000000002";
const TASK_ID = "00000000-0000-0000-0000-000000000003";
const USER_ID = "00000000-0000-0000-0000-000000000004";
const MEMBER_ID = "00000000-0000-0000-0000-000000000005";

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    startupId: STARTUP_ID,
    pipelineId: PIPELINE_ID,
    title: "Send follow-up deck",
    description: null,
    status: "open",
    priority: "medium",
    dueDate: null,
    assigneeId: null,
    completedAt: null,
    createdBy: USER_ID,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("TaskService.createTask", () => {
  it("creates a task scoped to the startup once the pipeline entry is verified", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.task.create as jest.Mock).mockResolvedValue(taskRow());

    const result = await service.createTask(
      STARTUP_ID,
      { pipelineId: PIPELINE_ID, title: "Send follow-up deck" } as never,
      USER_ID,
    );

    expect(mockPrisma.pipeline.findUnique).toHaveBeenCalledWith({
      where: { startupId_id: { startupId: STARTUP_ID, id: PIPELINE_ID } },
      select: { id: true },
    });
    expect(mockPrisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startupId: STARTUP_ID,
          pipelineId: PIPELINE_ID,
          title: "Send follow-up deck",
          createdBy: USER_ID,
        }),
      }),
    );
    expect(result.data.id).toBe(TASK_ID);
  });

  it("throws PIPELINE_NOT_FOUND for a cross-tenant pipeline id", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createTask(
        STARTUP_ID,
        { pipelineId: PIPELINE_ID, title: "x" } as never,
        USER_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: "PIPELINE_NOT_FOUND" });

    expect(mockPrisma.task.create).not.toHaveBeenCalled();
  });

  it("verifies the assignee belongs to the same startup before creating", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createTask(
        STARTUP_ID,
        { pipelineId: PIPELINE_ID, title: "x", assigneeId: MEMBER_ID } as never,
        USER_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });

    expect(mockPrisma.task.create).not.toHaveBeenCalled();
  });

  // Without this the assignee's only warning is the 9am overdue/due-today
  // cron, so work handed over weeks ahead stays invisible until it is due.
  it("tells the assignee about a task handed to them", async () => {
    const OTHER_USER = "00000000-0000-0000-0000-000000000009";
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      userId: OTHER_USER,
    });
    (mockPrisma.task.create as jest.Mock).mockResolvedValue(taskRow({ assigneeId: MEMBER_ID }));

    await service.createTask(
      STARTUP_ID,
      { pipelineId: PIPELINE_ID, title: "Send follow-up deck", assigneeId: MEMBER_ID } as never,
      USER_ID,
    );

    expect(mockNotifyAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_USER, taskId: TASK_ID, startupId: STARTUP_ID }),
    );
  });

  it("stays quiet when you assign a task to yourself", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      userId: USER_ID,
    });
    (mockPrisma.task.create as jest.Mock).mockResolvedValue(taskRow({ assigneeId: MEMBER_ID }));

    await service.createTask(
      STARTUP_ID,
      { pipelineId: PIPELINE_ID, title: "x", assigneeId: MEMBER_ID } as never,
      USER_ID,
    );

    expect(mockNotifyAssigned).not.toHaveBeenCalled();
  });

  it("stays quiet when the assignee is a pending invite with no account", async () => {
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: PIPELINE_ID });
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      userId: null,
    });
    (mockPrisma.task.create as jest.Mock).mockResolvedValue(taskRow({ assigneeId: MEMBER_ID }));

    await service.createTask(
      STARTUP_ID,
      { pipelineId: PIPELINE_ID, title: "x", assigneeId: MEMBER_ID } as never,
      USER_ID,
    );

    expect(mockNotifyAssigned).not.toHaveBeenCalled();
  });
});

describe("TaskService.listTasks", () => {
  it("scopes the query to the startup and returns pagination meta", async () => {
    (mockPrisma.task.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([taskRow()]);

    const result = await service.listTasks(STARTUP_ID, {
      page: 1,
      limit: 20,
    } as never);

    expect(mockPrisma.task.count).toHaveBeenCalledWith({ where: { startupId: STARTUP_ID } });
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it("filters by pipelineId, status, assigneeId and priority when provided", async () => {
    (mockPrisma.task.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([]);

    await service.listTasks(STARTUP_ID, {
      page: 1,
      limit: 20,
      pipelineId: PIPELINE_ID,
      status: "open",
      assigneeId: MEMBER_ID,
      priority: "high",
    } as never);

    expect(mockPrisma.task.count).toHaveBeenCalledWith({
      where: {
        startupId: STARTUP_ID,
        pipelineId: PIPELINE_ID,
        status: "open",
        assigneeId: MEMBER_ID,
        priority: "high",
      },
    });
  });

  // A task has no round of its own, so the filter reaches through its deal.
  it("scopes to a round through the deal when roundId is given", async () => {
    const ROUND_ID = "00000000-0000-0000-0000-000000000007";
    (mockPrisma.task.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.task.findMany as jest.Mock).mockResolvedValue([]);

    await service.listTasks(STARTUP_ID, { page: 1, limit: 20, roundId: ROUND_ID } as never);

    expect(mockPrisma.task.count).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, pipeline: { roundId: ROUND_ID } },
    });
  });
});

describe("TaskService.getTask", () => {
  it("throws TASK_NOT_FOUND for a missing or cross-tenant id", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue(taskRow());

    await expect(service.getTask(OTHER_STARTUP, TASK_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "TASK_NOT_FOUND",
    });
  });

  it("returns the task when it belongs to the startup", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue(taskRow());

    const result = await service.getTask(STARTUP_ID, TASK_ID);

    expect(result.data.id).toBe(TASK_ID);
  });
});

describe("TaskService.updateTask", () => {
  it("throws TASK_NOT_FOUND when the task is not in this startup", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.updateTask(STARTUP_ID, TASK_ID, { title: "x" } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "TASK_NOT_FOUND" });

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("stamps completedAt server-side when status moves to completed", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: STARTUP_ID,
      status: "open",
    });
    (mockPrisma.task.update as jest.Mock).mockResolvedValue(
      taskRow({ status: "completed", completedAt: new Date("2026-02-01") }),
    );

    await service.updateTask(STARTUP_ID, TASK_ID, { status: "completed" } as never);

    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", completedAt: expect.any(Date) }),
      }),
    );
  });

  it("clears completedAt when status moves back to open", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: STARTUP_ID,
      status: "completed",
    });
    (mockPrisma.task.update as jest.Mock).mockResolvedValue(taskRow());

    await service.updateTask(STARTUP_ID, TASK_ID, { status: "open" } as never);

    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "open", completedAt: null }) }),
    );
  });

  it("leaves completedAt untouched when status is not part of the update", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: STARTUP_ID,
      status: "open",
    });
    (mockPrisma.task.update as jest.Mock).mockResolvedValue(taskRow({ dueDate: new Date("2026-03-01") }));

    await service.updateTask(STARTUP_ID, TASK_ID, { dueDate: new Date("2026-03-01") } as never);

    const call = (mockPrisma.task.update as jest.Mock).mock.calls[0][0];
    expect(call.data).not.toHaveProperty("completedAt");
  });

  // A task filed against the wrong investor used to have to be deleted and
  // retyped, losing its assignee, due date and completion history.
  it("relinks a task to another deal once that deal is verified in the same startup", async () => {
    const OTHER_PIPELINE = "00000000-0000-0000-0000-000000000077";
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: STARTUP_ID,
      status: "open",
      assigneeId: null,
      pipelineId: PIPELINE_ID,
    });
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue({ id: OTHER_PIPELINE });
    (mockPrisma.task.update as jest.Mock).mockResolvedValue(taskRow({ pipelineId: OTHER_PIPELINE }));

    await service.updateTask(STARTUP_ID, TASK_ID, { pipelineId: OTHER_PIPELINE } as never);

    expect(mockPrisma.pipeline.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId_id: { startupId: STARTUP_ID, id: OTHER_PIPELINE } },
      }),
    );
    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pipelineId: OTHER_PIPELINE }) }),
    );
  });

  it("refuses to relink a task to a deal in another startup", async () => {
    const FOREIGN_PIPELINE = "00000000-0000-0000-0000-000000000078";
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: STARTUP_ID,
      status: "open",
      assigneeId: null,
      pipelineId: PIPELINE_ID,
    });
    // The composite key is what makes a foreign deal simply not exist here.
    (mockPrisma.pipeline.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.updateTask(STARTUP_ID, TASK_ID, { pipelineId: FOREIGN_PIPELINE } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "PIPELINE_NOT_FOUND" });

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("does not re-verify the deal when the link is unchanged", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: STARTUP_ID,
      status: "open",
      assigneeId: null,
      pipelineId: PIPELINE_ID,
    });
    (mockPrisma.task.update as jest.Mock).mockResolvedValue(taskRow());

    await service.updateTask(STARTUP_ID, TASK_ID, {
      pipelineId: PIPELINE_ID,
      title: "Same deal, new title",
    } as never);

    expect(mockPrisma.pipeline.findUnique).not.toHaveBeenCalled();
  });

  it("verifies a reassigned assignee belongs to the same startup", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: STARTUP_ID,
      status: "open",
    });
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.updateTask(STARTUP_ID, TASK_ID, { assigneeId: MEMBER_ID } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });
});

describe("TaskService.deleteTask", () => {
  it("deletes a task that belongs to the startup", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: STARTUP_ID,
    });
    (mockPrisma.task.delete as jest.Mock).mockResolvedValue({});

    await service.deleteTask(STARTUP_ID, TASK_ID);

    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: TASK_ID } });
  });

  it("throws TASK_NOT_FOUND for a cross-tenant id", async () => {
    (mockPrisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: TASK_ID,
      startupId: OTHER_STARTUP,
    });

    await expect(service.deleteTask(STARTUP_ID, TASK_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "TASK_NOT_FOUND",
    });
    expect(mockPrisma.task.delete).not.toHaveBeenCalled();
  });
});
