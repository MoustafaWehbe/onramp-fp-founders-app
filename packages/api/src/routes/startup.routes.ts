import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import {
  createStartupSchema,
  updateStartupSchema,
  startupIdParamSchema,
} from "../validators/startup.schemas";
import {
  inviteMemberSchema,
  changeRoleSchema,
  memberIdParamSchema,
} from "../validators/invite.schemas";
import { startupController } from "../controllers/startup.controller";
import { inviteController } from "../controllers/invite.controller";
import { investorRouter } from "./investor.routes";
import { pipelineRouter } from "./pipeline.routes";
import { interactionLogRouter } from "./interaction-log.routes";
import { fundraisingRouter } from "./fundraising.routes";
import { taskRouter } from "./task.routes";
import { auditRouter } from "./audit.routes";
import { documentRouter } from "./document.routes";
import { reviewerInvitationRouter } from "./reviewer-invitation.routes";

const router = Router();

// /api/v1/startups/:startupId/investors — declares its own middleware chain
router.use("/:startupId/investors", investorRouter);

// /api/v1/startups/:startupId/pipeline — declares its own middleware chain
router.use("/:startupId/pipeline", pipelineRouter);

// /api/v1/startups/:startupId/interaction-logs — declares its own middleware chain
router.use("/:startupId/interaction-logs", interactionLogRouter);

// /api/v1/startups/:startupId/tasks — declares its own middleware chain
router.use("/:startupId/tasks", taskRouter);

// /api/v1/startups/:startupId/audit-logs — workspace activity trail
router.use("/:startupId/audit-logs", auditRouter);

// /api/v1/startups/:startupId/documents
router.use("/:startupId/documents", documentRouter);

// /api/v1/startups/:startupId/reviewer-invitations
router.use("/:startupId/reviewer-invitations", reviewerInvitationRouter);

// Financial resources are startup-scoped just like the CRM resources.
router.use("/:startupId", fundraisingRouter);

// GET /api/v1/startups
// authenticate only — this is scoped by the caller's memberships, and it is
// what the client calls before it knows which startup it is working in.
router.get("/", authenticate, startupController.listMyStartups);

// POST /api/v1/startups
// authenticate only — the caller has no membership yet (they're creating the startup)
router.post(
  "/",
  authenticate,
  validate(createStartupSchema),
  startupController.createStartup,
);

// POST /api/v1/startups/:startupId/invites — team:create
router.post(
  "/:startupId/invites",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("team", "create"),
  validate(inviteMemberSchema),
  inviteController.inviteMember,
);

// POST /api/v1/startups/:startupId/invites/:memberId/resend — team:create
router.post(
  "/:startupId/invites/:memberId/resend",
  authenticate,
  validate(memberIdParamSchema, "params"),
  requireMember,
  requirePermission("team", "create"),
  inviteController.resendInvite,
);

// PUT /api/v1/startups/:startupId/activate — any active member
// Remembers which workspace this user was last in, so the choice follows them
// to another device instead of living only in that browser's storage.
router.put(
  "/:startupId/activate",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  startupController.activateStartup,
);

// GET /api/v1/startups/:startupId/roles — team:read
router.get(
  "/:startupId/roles",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("team", "read"),
  startupController.listRoles,
);

// GET /api/v1/startups/:startupId/members — team:read
router.get(
  "/:startupId/members",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("team", "read"),
  startupController.listMembers,
);

// PATCH /api/v1/startups/:startupId/members/:memberId/role — team:update
router.patch(
  "/:startupId/members/:memberId/role",
  authenticate,
  validate(memberIdParamSchema, "params"),
  requireMember,
  requirePermission("team", "update"),
  validate(changeRoleSchema),
  inviteController.changeRole,
);

// DELETE /api/v1/startups/:startupId/members/:memberId — team:delete
router.delete(
  "/:startupId/members/:memberId",
  authenticate,
  validate(memberIdParamSchema, "params"),
  requireMember,
  requirePermission("team", "delete"),
  inviteController.removeMember,
);

// GET /api/v1/startups/:startupId — any active member
router.get(
  "/:startupId",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  startupController.getStartup,
);

// PATCH /api/v1/startups/:startupId — startup:update
router.patch(
  "/:startupId",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("startup", "update"),
  validate(updateStartupSchema),
  startupController.updateStartup,
);

// DELETE /api/v1/startups/:startupId — startup:delete
router.delete(
  "/:startupId",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("startup", "delete"),
  startupController.deleteStartup,
);

export { router as startupRouter };
