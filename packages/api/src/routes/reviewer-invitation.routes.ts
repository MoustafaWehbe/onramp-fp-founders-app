import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createReviewerInvitationSchema,
  invitationIdParamSchema,
  listReviewerInvitationsQuerySchema,
} from "../validators/reviewer.schemas";
import { reviewerInvitationController } from "../controllers/reviewer-invitation.controller";

const router = Router({ mergeParams: true });

router.get(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "read"),
  validate(listReviewerInvitationsQuerySchema, "query"),
  reviewerInvitationController.listInvitations,
);

router.post(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "share"),
  validate(createReviewerInvitationSchema),
  reviewerInvitationController.createInvitation,
);

router.get(
  "/:invitationId/analytics",
  authenticate,
  validate(invitationIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "read"),
  reviewerInvitationController.getAnalytics,
);

router.post(
  "/:invitationId/revoke",
  authenticate,
  validate(invitationIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "share"),
  reviewerInvitationController.revokeInvitation,
);

export { router as reviewerInvitationRouter };
