import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createInvestorSchema,
  updateInvestorSchema,
  listInvestorsQuerySchema,
  investorIdParamSchema,
} from "../validators/investor.schemas";
import { investorController } from "../controllers/investor.controller";

// Mounted at /api/v1/startups/:startupId/investors — mergeParams keeps
// :startupId visible to the RBAC middleware and the controllers.
const router = Router({ mergeParams: true });

// POST /api/v1/startups/:startupId/investors — pipeline:create
router.post(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "create"),
  validate(createInvestorSchema),
  investorController.createInvestor,
);

// GET /api/v1/startups/:startupId/investors — pipeline:read
router.get(
  "/",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  validate(listInvestorsQuerySchema, "query"),
  investorController.listInvestors,
);

// GET /api/v1/startups/:startupId/investors/:investorId — pipeline:read
router.get(
  "/:investorId",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "read"),
  investorController.getInvestor,
);

// PATCH /api/v1/startups/:startupId/investors/:investorId — pipeline:update
router.patch(
  "/:investorId",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "update"),
  validate(updateInvestorSchema),
  investorController.updateInvestor,
);

// DELETE /api/v1/startups/:startupId/investors/:investorId — pipeline:delete
router.delete(
  "/:investorId",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "delete"),
  investorController.deleteInvestor,
);

export { router as investorRouter };
