import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createTaskSchema,
  updateTaskSchema,
  listTaskQuerySchema,
  taskIdParamSchema,
} from "../validators/task.schemas";
import { taskController } from "../controllers/task.controller";

// Mounted at /api/v1/startups/:startupId/tasks — mergeParams keeps
// :startupId visible to the RBAC middleware and the controller. Tasks reuse
// pipeline:* permissions, the same way interaction logs do — there is no
// separate "task" resource.
const router = Router({ mergeParams: true });

// POST /api/v1/startups/:startupId/tasks — pipeline:create
router.post(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "create"),
  validate(createTaskSchema),
  taskController.createTask,
);

// GET /api/v1/startups/:startupId/tasks — pipeline:read
router.get(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(listTaskQuerySchema, "query"),
  taskController.listTasks,
);

// GET /api/v1/startups/:startupId/tasks/:taskId — pipeline:read
router.get(
  "/:taskId",
  authenticate,
  validate(taskIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  taskController.getTask,
);

// PATCH /api/v1/startups/:startupId/tasks/:taskId — pipeline:update
router.patch(
  "/:taskId",
  authenticate,
  validate(taskIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "update"),
  validate(updateTaskSchema),
  taskController.updateTask,
);

// DELETE /api/v1/startups/:startupId/tasks/:taskId — pipeline:delete
router.delete(
  "/:taskId",
  authenticate,
  validate(taskIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "delete"),
  taskController.deleteTask,
);

export { router as taskRouter };
