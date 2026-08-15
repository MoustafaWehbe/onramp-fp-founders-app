import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createPipelineEntrySchema,
  updatePipelineEntrySchema,
  listPipelineQuerySchema,
  pipelineAnalyticsQuerySchema,
  pipelineIdParamSchema,
} from "../validators/pipeline.schemas";
import { listInteractionLogQuerySchema } from "../validators/interaction-log.schemas";
import { pipelineController } from "../controllers/pipeline.controller";
import { interactionLogController } from "../controllers/interaction-log.controller";

// Mounted at /api/v1/startups/:startupId/pipeline mergeParams keeps
// :startupId visible to the RBAC middleware and the controllers.
const router = Router({ mergeParams: true });

// POST /api/v1/startups/:startupId/pipeline pipeline:create
router.post(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "create"),
  validate(createPipelineEntrySchema),
  pipelineController.createEntry,
);

// GET /api/v1/startups/:startupId/pipeline pipeline:read
router.get(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(listPipelineQuerySchema, "query"),
  pipelineController.listEntries,
);

// GET /api/v1/startups/:startupId/pipeline/analytics pipeline:read
// Registered before /:pipelineId so "analytics" is never parsed as an id.
router.get(
  "/analytics",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(pipelineAnalyticsQuerySchema, "query"),
  pipelineController.getAnalytics,
);

// GET /api/v1/startups/:startupId/pipeline/focus pipeline:read
// Registered before /:pipelineId so "focus" is never parsed as an id.
router.get(
  "/focus",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(pipelineAnalyticsQuerySchema, "query"),
  pipelineController.getFocus,
);

// GET /api/v1/startups/:startupId/pipeline/:pipelineId pipeline:read
router.get(
  "/:pipelineId",
  authenticate,
  validate(pipelineIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  pipelineController.getEntry,
);

// PATCH /api/v1/startups/:startupId/pipeline/:pipelineId pipeline:update
router.patch(
  "/:pipelineId",
  authenticate,
  validate(pipelineIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "update"),
  validate(updatePipelineEntrySchema),
  pipelineController.updateEntry,
);

// DELETE /api/v1/startups/:startupId/pipeline/:pipelineId pipeline:delete
router.delete(
  "/:pipelineId",
  authenticate,
  validate(pipelineIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "delete"),
  pipelineController.deleteEntry,
);

// GET /api/v1/startups/:startupId/pipeline/:pipelineId/interaction-logs pipeline:read
router.get(
  "/:pipelineId/interaction-logs",
  authenticate,
  validate(pipelineIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(listInteractionLogQuerySchema, "query"),
  interactionLogController.listLogsByPipeline,
);

// GET /api/v1/startups/:startupId/pipeline/:pipelineId/stage-events pipeline:read
router.get(
  "/:pipelineId/stage-events",
  authenticate,
  validate(pipelineIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  pipelineController.listStageEvents,
);

export { router as pipelineRouter };
