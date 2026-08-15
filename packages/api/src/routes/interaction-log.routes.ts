import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createInteractionLogSchema,
  updateInteractionLogSchema,
  listInteractionLogQuerySchema,
  logIdParamSchema,
} from "../validators/interaction-log.schemas";
import { interactionLogController } from "../controllers/interaction-log.controller";

// Mounted at /api/v1/startups/:startupId/interaction-logs mergeParams keeps
// :startupId visible to the RBAC middleware and the controllers.
const router = Router({ mergeParams: true });

// POST /api/v1/startups/:startupId/interaction-logs pipeline:create
router.post(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "create"),
  validate(createInteractionLogSchema),
  interactionLogController.createLog,
);

// GET /api/v1/startups/:startupId/interaction-logs pipeline:read
router.get(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(listInteractionLogQuerySchema, "query"),
  interactionLogController.listLogs,
);

// GET /api/v1/startups/:startupId/interaction-logs/:logId pipeline:read
router.get(
  "/:logId",
  authenticate,
  validate(logIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  interactionLogController.getLog,
);

// PATCH /api/v1/startups/:startupId/interaction-logs/:logId pipeline:update
router.patch(
  "/:logId",
  authenticate,
  validate(logIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "update"),
  validate(updateInteractionLogSchema),
  interactionLogController.updateLog,
);

// DELETE /api/v1/startups/:startupId/interaction-logs/:logId pipeline:delete
router.delete(
  "/:logId",
  authenticate,
  validate(logIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "delete"),
  interactionLogController.deleteLog,
);

export { router as interactionLogRouter };