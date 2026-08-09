import { Router } from "express";
import { z } from "zod";
import { validate } from "../utils/validate";
import { authenticate, optionalAuthenticate } from "../middleware/auth";
import { acceptInviteSchema } from "../validators/invite.schemas";
import { inviteController } from "../controllers/invite.controller";

const router = Router();

const memberIdParam = z.object({ memberId: z.string().uuid("Invalid member ID") });

// Invitations addressed to the signed-in user. Someone who was already logged
// in when the invite arrived accepts from inside the app; no emailed token is
// involved, because the session already proves who they are.
router.get("/mine", authenticate, inviteController.listMyInvites);
router.post(
  "/mine/:memberId/accept",
  authenticate,
  validate(memberIdParam, "params"),
  inviteController.acceptMyInvite,
);
router.post(
  "/mine/:memberId/decline",
  authenticate,
  validate(memberIdParam, "params"),
  inviteController.declineMyInvite,
);

// POST /api/v1/invites/accept — reachable signed-out, but the invitation is
// only ever activated for a signed-in user whose email matches the invite.
router.post(
  "/accept",
  optionalAuthenticate,
  validate(acceptInviteSchema),
  inviteController.acceptInvite,
);

export { router as inviteRouter };