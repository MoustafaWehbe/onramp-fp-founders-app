import { Router } from "express";
import { authRouter } from "./auth.routes";
import { startupRouter } from "./startup.routes";
import { inviteRouter } from "./invite.routes";
import { notificationRouter } from "./notification.routes";
import { integrationsRouter } from "./integrations.routes";
import { userRouter } from "./user.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/startups", startupRouter);
router.use("/invites", inviteRouter);
router.use("/notifications", notificationRouter);
router.use("/integrations", integrationsRouter);
router.use("/users", userRouter);

export { router };
