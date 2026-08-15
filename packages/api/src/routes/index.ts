import { Router } from "express";
import { authRouter } from "./auth.routes";
import { startupRouter } from "./startup.routes";
import { inviteRouter } from "./invite.routes";
import { notificationRouter } from "./notification.routes";
import { reviewerPortalRouter } from "./reviewer-portal.routes";
import { documentController } from "../controllers/document.controller";
import { integrationsRouter } from "./integrations.routes";
import { userRouter } from "./user.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/startups", startupRouter);
router.use("/invites", inviteRouter);
router.use("/notifications", notificationRouter);
router.use("/reviewer-portal", reviewerPortalRouter);

// Local download stays on the router; upload is registered in app.ts before JSON parsing.
router.get("/documents/local-download/:token", documentController.localDownload);
router.use("/integrations", integrationsRouter);
router.use("/users", userRouter);

export { router };
