import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createUploadSessionSchema,
  createVersionUploadSchema,
  documentIdParamSchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
  versionParamSchema,
} from "../validators/document.schemas";
import { documentController } from "../controllers/document.controller";

const router = Router({ mergeParams: true });

router.get(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "read"),
  validate(listDocumentsQuerySchema, "query"),
  documentController.listDocuments,
);

router.post(
  "/upload-sessions",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "create"),
  validate(createUploadSessionSchema),
  documentController.createUploadSession,
);

router.get(
  "/:documentId",
  authenticate,
  validate(documentIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "read"),
  documentController.getDocument,
);

router.patch(
  "/:documentId",
  authenticate,
  validate(documentIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "update"),
  validate(updateDocumentSchema),
  documentController.updateDocument,
);

router.delete(
  "/:documentId",
  authenticate,
  validate(documentIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "delete"),
  documentController.deleteDocument,
);

router.post(
  "/:documentId/versions/upload-sessions",
  authenticate,
  validate(documentIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "update"),
  validate(createVersionUploadSchema),
  documentController.createVersionUploadSession,
);

router.post(
  "/:documentId/versions/:versionId/confirm",
  authenticate,
  validate(versionParamSchema, "params"),
  requireMember,
  // Same permission as creating a version upload session — confirming is part of update.
  requirePermission("documents", "update"),
  documentController.confirmVersion,
);

router.post(
  "/:documentId/file-access",
  authenticate,
  validate(documentIdParamSchema, "params"),
  requireMember,
  requirePermission("documents", "read"),
  documentController.getFileAccess,
);

export { router as documentRouter };
