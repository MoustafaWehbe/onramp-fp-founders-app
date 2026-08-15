import { Router } from "express";
import { authRouter } from "./auth.routes";
import { startupRouter } from "./startup.routes";
import { inviteRouter } from "./invite.routes";
import { notificationRouter } from "./notification.routes";
import { reviewerPortalRouter } from "./reviewer-portal.routes";
import { documentController } from "../controllers/document.controller";
import { integrationsRouter } from "./integrations.routes";
import { userRouter } from "./user.routes";
import { userController } from "../controllers/user.controller";

const router = Router();

router.use("/auth", authRouter);
router.use("/startups", startupRouter);
router.use("/invites", inviteRouter);
router.use("/notifications", notificationRouter);
router.use("/reviewer-portal", reviewerPortalRouter);

// Local download stays on the router; upload is registered in app.ts before JSON parsing.
router.get("/documents/local-download/:token", documentController.localDownload);

// Local/dev counterpart to a public avatar bucket: unlike document downloads
// this is intentionally public and cache-friendly, not token-gated a
// profile photo is meant to be visible to anyone rendering the user, and
// object-storage URLs from uploadAvatar() are public for the same reason.
router.get("/avatar-files/:userId/:filename", userController.avatarFile);

router.use("/integrations", integrationsRouter);
router.use("/users", userRouter);

export { router };
