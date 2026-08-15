import { Router } from "express";
import { authRouter } from "./auth.routes";
import { startupRouter } from "./startup.routes";
import { inviteRouter } from "./invite.routes";
import { notificationRouter } from "./notification.routes";
import { reviewerPortalRouter } from "./reviewer-portal.routes";
import { documentController } from "../controllers/document.controller";

const router = Router();

router.use("/auth", authRouter);
router.use("/startups", startupRouter);
router.use("/invites", inviteRouter);
router.use("/notifications", notificationRouter);
router.use("/reviewer-portal", reviewerPortalRouter);

// Local download stays on the router; upload is registered in app.ts before JSON parsing.
router.get("/documents/local-download/:token", documentController.localDownload);

export { router };
