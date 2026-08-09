import { Router } from "express";
import { authRouter } from "./auth.routes";
import { startupRouter } from "./startup.routes";
import { inviteRouter } from "./invite.routes";
import { notificationRouter } from "./notification.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/startups", startupRouter);
router.use("/invites", inviteRouter);
router.use("/notifications", notificationRouter);

export { router };
