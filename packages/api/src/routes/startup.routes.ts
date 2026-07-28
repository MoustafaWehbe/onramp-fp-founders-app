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

const router = Router();

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