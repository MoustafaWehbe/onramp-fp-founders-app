import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createReviewerInvitationSchema,
  invitationIdParamSchema,
  listFounderReviewerCommentsQuerySchema,
  listReviewerInvitationsQuerySchema,
  reviewerCommentIdParamSchema,
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
  "/comments",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "read"),
  validate(listFounderReviewerCommentsQuerySchema, "query"),
  reviewerInvitationController.listComments,
);

router.post(
  "/comments/:commentId/read",
  authenticate,
  validate(reviewerCommentIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "read"),
  reviewerInvitationController.markCommentRead,
);

router.post(
  "/comments/:commentId/resolve",
  authenticate,
  validate(reviewerCommentIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "update"),
  reviewerInvitationController.resolveComment,
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
  "/:invitationId/resend",
  authenticate,
  validate(invitationIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "share"),
  reviewerInvitationController.resendInvitation,
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
