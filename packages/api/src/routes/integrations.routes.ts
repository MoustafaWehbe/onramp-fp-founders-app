import { Router } from "express";
import { validate } from "../utils/validate";
import { authenticate } from "../middleware/auth";
import { integrationsController } from "../controllers/integrations.controller";
import {
  googleCallbackQuerySchema,
  calendarSyncSettingSchema,
} from "../validators/integrations.schemas";

const router = Router();

// Google's own redirect lands here — a plain browser navigation that may
// arrive after the access-token cookie has expired during consent. It proves
// itself via the state token instead, so it is reachable without a session.
router.get(
  "/google/callback",
  validate(googleCallbackQuerySchema, "query"),
  integrationsController.callback,
);

router.use(authenticate);

router.get("/google/status", integrationsController.status);
router.get("/google/connect", integrationsController.connect);
router.post("/google/disconnect", integrationsController.disconnect);

router.patch(
  "/google/calendar-sync",
  validate(calendarSyncSettingSchema),
  integrationsController.setCalendarSync,
);
router.post("/google/calendar-sync/trigger", integrationsController.triggerCalendarSync);

export { router as integrationsRouter };
