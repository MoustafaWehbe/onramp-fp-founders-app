import { Router } from "express";
import { validate } from "../utils/validate";
import { requireReviewerSession } from "../middleware/reviewer-auth";
import {
  reviewerAccessRateLimiter,
  reviewerEventRateLimiter,
  reviewerTelemetryRateLimiter,
} from "../middleware/rate-limiter";
import {
  reviewerAccessSchema,
  reviewerCommentSchema,
  reviewerEventSchema,
  reviewerPageParamSchema,
  reviewerPageQuerySchema,
  reviewerTelemetrySchema,
  reviewerVerifySchema,
  reviewerVersionIdParamSchema,
} from "../validators/reviewer-portal.schemas";
import { reviewerPortalController } from "../controllers/reviewer-portal.controller";

const router = Router();

router.post(
  "/access",
  reviewerAccessRateLimiter,
  validate(reviewerAccessSchema),
  reviewerPortalController.requestAccess,
);

router.post(
  "/verify",
  reviewerAccessRateLimiter,
  validate(reviewerVerifySchema),
  reviewerPortalController.verifyAccess,
);

router.get("/workspace", requireReviewerSession, reviewerPortalController.getWorkspace);

router.post("/nda/accept", requireReviewerSession, reviewerPortalController.acceptNda);

// Page images replace any form of file access. There is deliberately no route
// from this router to a signed URL for a source object — see getPageManifest.
router.get(
  "/documents/:versionId/manifest",
  requireReviewerSession,
  validate(reviewerVersionIdParamSchema, "params"),
  reviewerPortalController.getPageManifest,
);

router.get(
  "/pages/:versionId/:pageNumber",
  requireReviewerSession,
  validate(reviewerPageParamSchema, "params"),
  validate(reviewerPageQuerySchema, "query"),
  reviewerPortalController.getPageImage,
);

router.get(
  "/documents/:versionId/download",
  requireReviewerSession,
  validate(reviewerVersionIdParamSchema, "params"),
  reviewerPortalController.getDownload,
);

router.get("/comments", requireReviewerSession, reviewerPortalController.listComments);

router.post(
  "/comments",
  requireReviewerSession,
  validate(reviewerCommentSchema),
  reviewerPortalController.createComment,
);

router.post(
  "/events",
  requireReviewerSession,
  reviewerEventRateLimiter,
  validate(reviewerEventSchema),
  reviewerPortalController.logEvent,
);

router.post(
  "/telemetry",
  requireReviewerSession,
  reviewerTelemetryRateLimiter,
  validate(reviewerTelemetrySchema),
  reviewerPortalController.recordTelemetry,
);

router.post("/complete", requireReviewerSession, reviewerPortalController.complete);

router.post("/logout", requireReviewerSession, reviewerPortalController.logout);

export { router as reviewerPortalRouter };
