import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { fundraisingController } from "../controllers/fundraising.controller";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  commitmentIdParamSchema,
  createCommitmentSchema,
  createFundraisingRoundSchema,
  fundraisingRoundIdParamSchema,
  listCommitmentsQuerySchema,
  listFundraisingRoundsQuerySchema,
  updateCommitmentSchema,
  updateFundraisingRoundSchema,
} from "../validators/fundraising.schemas";

const financialRead = [authenticate, validate(startupIdParamSchema, "params"), requireMember, requirePermission("financial", "read")] as const;
const router = Router({ mergeParams: true });

router.get("/fundraising-rounds", ...financialRead, validate(listFundraisingRoundsQuerySchema, "query"), fundraisingController.listRounds);
router.post("/fundraising-rounds", authenticate, validate(startupIdParamSchema, "params"), requireMember, requirePermission("financial", "create"), validate(createFundraisingRoundSchema), fundraisingController.createRound);
router.get("/fundraising-rounds/:roundId", authenticate, validate(fundraisingRoundIdParamSchema, "params"), requireMember, requirePermission("financial", "read"), fundraisingController.getRound);
router.patch("/fundraising-rounds/:roundId", authenticate, validate(fundraisingRoundIdParamSchema, "params"), requireMember, requirePermission("financial", "update"), validate(updateFundraisingRoundSchema), fundraisingController.updateRound);
router.delete("/fundraising-rounds/:roundId", authenticate, validate(fundraisingRoundIdParamSchema, "params"), requireMember, requirePermission("financial", "delete"), fundraisingController.deleteRound);
router.get("/fundraising-rounds/:roundId/commitments", authenticate, validate(fundraisingRoundIdParamSchema, "params"), requireMember, requirePermission("financial", "read"), validate(listCommitmentsQuerySchema, "query"), fundraisingController.listRoundCommitments);
router.get("/fundraising-rounds/:roundId/metrics", authenticate, validate(fundraisingRoundIdParamSchema, "params"), requireMember, requirePermission("financial", "read"), fundraisingController.getRoundMetrics);
router.get("/fundraising-rounds/:roundId/funding-history", authenticate, validate(fundraisingRoundIdParamSchema, "params"), requireMember, requirePermission("financial", "read"), fundraisingController.getFundingHistory);

router.get("/commitments", ...financialRead, validate(listCommitmentsQuerySchema, "query"), fundraisingController.listCommitments);
router.post("/commitments", authenticate, validate(startupIdParamSchema, "params"), requireMember, requirePermission("financial", "create"), validate(createCommitmentSchema), fundraisingController.createCommitment);
router.get("/commitments/:commitmentId", authenticate, validate(commitmentIdParamSchema, "params"), requireMember, requirePermission("financial", "read"), fundraisingController.getCommitment);
router.patch("/commitments/:commitmentId", authenticate, validate(commitmentIdParamSchema, "params"), requireMember, requirePermission("financial", "update"), validate(updateCommitmentSchema), fundraisingController.updateCommitment);
router.delete("/commitments/:commitmentId", authenticate, validate(commitmentIdParamSchema, "params"), requireMember, requirePermission("financial", "delete"), fundraisingController.deleteCommitment);

export { router as fundraisingRouter };
