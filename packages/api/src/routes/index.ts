import { Router } from "express";
import { authRouter } from "./auth.routes";
import { startupRouter } from "./startup.routes";
import { inviteRouter } from "./invite.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/startups", startupRouter);
router.use("/invites", inviteRouter);

export { router };
