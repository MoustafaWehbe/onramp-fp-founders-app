import { Router } from "express";
import { validate } from "../utils/validate";
import { requireReviewerSession } from "../middleware/reviewer-auth";
import {
  reviewerAccessSchema,
  reviewerCommentSchema,
  reviewerDocumentIdParamSchema,
  reviewerVerifySchema,
} from "../validators/reviewer-portal.schemas";
import { reviewerPortalController } from "../controllers/reviewer-portal.controller";

const router = Router();

router.post(
  "/access",
  validate(reviewerAccessSchema),
  reviewerPortalController.requestAccess,
);

router.post(
  "/verify",
  validate(reviewerVerifySchema),
  reviewerPortalController.verifyAccess,
);

router.get("/workspace", requireReviewerSession, reviewerPortalController.getWorkspace);

router.post(
  "/documents/:documentId/file-access",
  requireReviewerSession,
  validate(reviewerDocumentIdParamSchema, "params"),
  reviewerPortalController.getFileAccess,
);

router.get("/comments", requireReviewerSession, reviewerPortalController.listComments);

router.post(
  "/comments",
  requireReviewerSession,
  validate(reviewerCommentSchema),
  reviewerPortalController.createComment,
);

router.post("/complete", requireReviewerSession, reviewerPortalController.complete);

router.post("/logout", requireReviewerSession, reviewerPortalController.logout);

export { router as reviewerPortalRouter };
