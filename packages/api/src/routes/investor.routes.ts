import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { emailSendRateLimiter, scheduleMeetingRateLimiter } from "../middleware/rate-limiter";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createInvestorSchema,
  updateInvestorSchema,
  listInvestorsQuerySchema,
  investorIdParamSchema,
} from "../validators/investor.schemas";
import { listInteractionLogQuerySchema } from "../validators/interaction-log.schemas";
import { sendInvestorEmailSchema } from "../validators/gmail.schemas";
import { scheduleMeetingSchema } from "../validators/calendar-event.schemas";
import { investorController } from "../controllers/investor.controller";
import { interactionLogController } from "../controllers/interaction-log.controller";
import { gmailController } from "../controllers/gmail.controller";
import { calendarEventController } from "../controllers/calendar-event.controller";

// Mounted at /api/v1/startups/:startupId/investors mergeParams keeps
// :startupId visible to the RBAC middleware and the controllers.
const router = Router({ mergeParams: true });

// POST /api/v1/startups/:startupId/investors pipeline:create
router.post(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "create"),
  validate(createInvestorSchema),
  investorController.createInvestor,
);

// GET /api/v1/startups/:startupId/investors pipeline:read
router.get(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(listInvestorsQuerySchema, "query"),
  investorController.listInvestors,
);

// GET /api/v1/startups/:startupId/investors/:investorId pipeline:read
router.get(
  "/:investorId",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  investorController.getInvestor,
);

// PATCH /api/v1/startups/:startupId/investors/:investorId pipeline:update
router.patch(
  "/:investorId",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "update"),
  validate(updateInvestorSchema),
  investorController.updateInvestor,
);

// DELETE /api/v1/startups/:startupId/investors/:investorId pipeline:delete
router.delete(
  "/:investorId",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "delete"),
  investorController.deleteInvestor,
);

// GET /api/v1/startups/:startupId/investors/:investorId/interaction-logs pipeline:read
router.get(
  "/:investorId/interaction-logs",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(listInteractionLogQuerySchema, "query"),
  interactionLogController.listLogsByInvestor,
);

// POST /api/v1/startups/:startupId/investors/:investorId/send-email pipeline:create
router.post(
  "/:investorId/send-email",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "create"),
  emailSendRateLimiter,
  validate(sendInvestorEmailSchema),
  gmailController.sendEmail,
);

// POST /api/v1/startups/:startupId/investors/:investorId/schedule-meeting pipeline:create
router.post(
  "/:investorId/schedule-meeting",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "create"),
  scheduleMeetingRateLimiter,
  validate(scheduleMeetingSchema),
  calendarEventController.scheduleMeeting,
);

export { router as investorRouter };
