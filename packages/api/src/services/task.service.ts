import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { notificationService } from "./notification.service";
import type { CreateTaskInput, UpdateTaskInput, ListTaskQuery } from "../validators/task.schemas";

const TASK_SELECT = {
  id: true,
  startupId: true,
  pipelineId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  assigneeId: true,
  completedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TaskRow = {
  id: string;
  startupId: string;
  pipelineId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  assigneeId: string | null;
  completedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    startupId: row.startupId,
    pipelineId: row.pipelineId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    assigneeId: row.assigneeId,
    completedAt: row.completedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TaskService {
  private async verifyPipeline(startupId: string, pipelineId: string): Promise<void> {
    const pipeline = await prisma.pipeline.findUnique({
      where: { startupId_id: { startupId, id: pipelineId } },
      select: { id: true },
    });
    if (!pipeline) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");
  }

  /**
   * Returns the assignee's user id, or null when the member is still a
   * pending invite with no account yet — there is nobody to notify in that
   * case, but the assignment itself is allowed.
   */
  private async verifyAssignee(startupId: string, assigneeId: string): Promise<string | null> {
    const member = await prisma.startupMember.findUnique({
      where: { startupId_id: { startupId, id: assigneeId } },
      select: { id: true, userId: true },
    });
    if (!member) throw createError("Assignee is not a member of this startup", 404, "MEMBER_NOT_FOUND");
    return member.userId;
  }

  /**
   * Best-effort ping to whoever just picked up the task. Assigning work to
   * yourself needs no announcement, and a failure here must never fail the
   * write that caused it.
   */
  private announceAssignment(
    assigneeUserId: string | null,
    actorUserId: string,
    task: { id: string; startupId: string; title: string; dueDate: Date | null },
  ): void {
    if (!assigneeUserId || assigneeUserId === actorUserId) return;
    void notificationService.notifyTaskAssigned({
      userId: assigneeUserId,
      startupId: task.startupId,
      taskId: task.id,
      title: task.title,
      dueDate: task.dueDate,
    });
  }

  async createTask(startupId: string, input: CreateTaskInput, userId: string) {
    await this.verifyPipeline(startupId, input.pipelineId);
    const assigneeUserId = input.assigneeId
      ? await this.verifyAssignee(startupId, input.assigneeId)
      : null;

    const task = await prisma.task.create({
      data: {
        startupId,
        pipelineId: input.pipelineId,
        title: input.title,
        description: input.description ?? null,
        ...(input.priority !== undefined && { priority: input.priority }),
        dueDate: input.dueDate ?? null,
        assigneeId: input.assigneeId ?? null,
        createdBy: userId,
      },
      select: TASK_SELECT,
    });

    this.announceAssignment(assigneeUserId, userId, task);

    return { data: serializeTask(task) };
  }

  async listTasks(startupId: string, query: ListTaskQuery) {
    const { page, limit, pipelineId, roundId, status, assigneeId, priority } = query;

    const where: Prisma.TaskWhereInput = {
      startupId,
      ...(pipelineId && { pipelineId }),
      // Scoped through the deal, since a task has no round of its own.
      ...(roundId && { pipeline: { roundId } }),
      ...(status && { status }),
      ...(assigneeId && { assigneeId }),
      ...(priority && { priority }),
    };

    const [total, rows] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        // Open work first, soonest due date first; undated tasks sort last
        // within each status so a founder sees what's actually time-boxed.
        orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: TASK_SELECT,
      }),
    ]);

    return {
      data: rows.map(serializeTask),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTask(startupId: string, taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: TASK_SELECT,
    });
    if (!task || task.startupId !== startupId) {
      throw createError("Task not found", 404, "TASK_NOT_FOUND");
    }
    return { data: serializeTask(task) };
  }

  async updateTask(startupId: string, taskId: string, input: UpdateTaskInput, userId?: string) {
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, startupId: true, status: true, assigneeId: true },
    });
    if (!existing || existing.startupId !== startupId) {
      throw createError("Task not found", 404, "TASK_NOT_FOUND");
    }

    // Only a genuine hand-over is worth announcing — editing a due date on a
    // task someone already holds is not news.
    const reassigned =
      input.assigneeId !== undefined &&
      input.assigneeId !== null &&
      input.assigneeId !== existing.assigneeId;
    const assigneeUserId = input.assigneeId
      ? await this.verifyAssignee(startupId, input.assigneeId)
      : null;

    // Completion timestamp is derived server-side, not trusted from the
    // client — the same approach updateEntry uses for stageChangedAt.
    const statusChanged = input.status !== undefined && input.status !== existing.status;
    const completedAt =
      statusChanged && input.status === "completed"
        ? new Date()
        : statusChanged && input.status === "open"
          ? null
          : undefined;

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
        ...(completedAt !== undefined && { completedAt }),
      },
      select: TASK_SELECT,
    });

    if (reassigned && userId) this.announceAssignment(assigneeUserId, userId, task);

    return { data: serializeTask(task) };
  }

  async deleteTask(startupId: string, taskId: string) {
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, startupId: true },
    });
    if (!existing || existing.startupId !== startupId) {
      throw createError("Task not found", 404, "TASK_NOT_FOUND");
    }

    await prisma.task.delete({ where: { id: taskId } });
  }
}

export const taskService = new TaskService();
