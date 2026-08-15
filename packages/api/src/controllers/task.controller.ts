import { asyncHandler } from "../utils/errors";
import { taskService } from "../services/task.service";
import { notificationService } from "../services/notification.service";
import type { CreateTaskInput, UpdateTaskInput, ListTaskQuery } from "../validators/task.schemas";

export const taskController = {
  createTask: asyncHandler(async (req, res) => {
    const result = await taskService.createTask(
      req.params.startupId as string,
      req.body as CreateTaskInput,
      req.user!.userId,
    );
    res.status(201).json(result);
  }),

  listTasks: asyncHandler(async (req, res) => {
    const result = await taskService.listTasks(
      req.params.startupId as string,
      req.query as unknown as ListTaskQuery,
    );
    res.json(result);
  }),

  getTask: asyncHandler(async (req, res) => {
    const result = await taskService.getTask(
      req.params.startupId as string,
      req.params.taskId as string,
    );
    res.json(result);
  }),

  updateTask: asyncHandler(async (req, res) => {
    const taskId = req.params.taskId as string;
    const input = req.body as UpdateTaskInput;
    const result = await taskService.updateTask(
      req.params.startupId as string,
      taskId,
      input,
      req.user!.userId,
    );

    // Completing or reopening a task clears whatever overdue/due-today
    // notice is sitting on it a fresh one fires later if it slips again.
    if (input.status !== undefined || input.dueDate !== undefined) {
      void notificationService.clearTaskNotifications([taskId]);
    }

    res.json(result);
  }),

  deleteTask: asyncHandler(async (req, res) => {
    const taskId = req.params.taskId as string;
    await taskService.deleteTask(req.params.startupId as string, taskId);
    void notificationService.clearTaskNotifications([taskId]);
    res.json({ message: "Task removed" });
  }),
};
