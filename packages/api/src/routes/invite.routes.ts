import { Router } from "express";
import { validate } from "../utils/validate";
import { acceptInviteSchema } from "../validators/invite.schemas";
import { inviteController } from "../controllers/invite.controller";

const router = Router();

// POST /api/v1/invites/accept — PUBLIC (no auth required)
router.post(
  "/accept",
  validate(acceptInviteSchema),
  inviteController.acceptInvite,
);

export { router as inviteRouter };