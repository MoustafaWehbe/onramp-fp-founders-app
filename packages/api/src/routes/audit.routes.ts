import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import { listAuditLogsQuerySchema } from "../validators/audit.schemas";
import { auditController } from "../controllers/audit.controller";

// Mounted at /api/v1/startups/:startupId/audit-logs
const router = Router({ mergeParams: true });

router.get(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("startup", "read"),
  validate(listAuditLogsQuerySchema, "query"),
  auditController.listLogs,
);

router.get(
  "/export",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("startup", "read"),
  validate(listAuditLogsQuerySchema, "query"),
  auditController.exportLogs,
);

router.get(
  "/facets",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("startup", "read"),
  auditController.facets,
);

export { router as auditRouter };
