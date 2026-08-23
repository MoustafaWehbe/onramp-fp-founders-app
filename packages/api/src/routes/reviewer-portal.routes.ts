import { Router } from "express";
import { validate } from "../utils/validate";
import { requireReviewerSession } from "../middleware/reviewer-auth";
import {
  reviewerAccessRateLimiter,
  reviewerCommentRateLimiter,
  reviewerContentRateLimiter,
  reviewerDownloadRateLimiter,
  reviewerEventRateLimiter,
  reviewerTelemetryRateLimiter,
} from "../middleware/rate-limiter";
import {
  reviewerAccessSchema,
  reviewerCommentSchema,
  reviewerCommentsQuerySchema,
  reviewerEventSchema,
  reviewerPageParamSchema,
  reviewerPageQuerySchema,
  reviewerTelemetrySchema,
  reviewerVerifySchema,
  reviewerVersionIdParamSchema,
} from "../validators/reviewer-portal.schemas";
import { reviewerPortalController } from "../controllers/reviewer-portal.controller";
import { reviewerMetricsMiddleware } from "../observability/reviewer-metrics";

const router = Router();

router.use(reviewerMetricsMiddleware);

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
  reviewerContentRateLimiter,
  validate(reviewerVersionIdParamSchema, "params"),
  reviewerPortalController.getPageManifest,
);

router.get(
  "/pages/:versionId/:pageNumber",
  requireReviewerSession,
  reviewerContentRateLimiter,
  validate(reviewerPageParamSchema, "params"),
  validate(reviewerPageQuerySchema, "query"),
  reviewerPortalController.getPageImage,
);

router.get(
  "/documents/:versionId/download",
  requireReviewerSession,
  reviewerDownloadRateLimiter,
  validate(reviewerVersionIdParamSchema, "params"),
  reviewerPortalController.getDownload,
);

router.get(
  "/comments",
  requireReviewerSession,
  validate(reviewerCommentsQuerySchema, "query"),
  reviewerPortalController.listComments,
);

router.post(
  "/comments",
  requireReviewerSession,
  reviewerCommentRateLimiter,
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
