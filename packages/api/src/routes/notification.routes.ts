import { Router } from "express";
import { validate } from "../utils/validate";
import { authenticate } from "../middleware/auth";
import { notificationController } from "../controllers/notification.controller";
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from "../validators/notification.schemas";

const router = Router();

// Notifications belong to the signed-in user across every workspace they touch,
// including ones they have only been invited to — so there is no startupId in
// the path and no membership check.
router.use(authenticate);

router.get("/", validate(listNotificationsQuerySchema, "query"), notificationController.list);
router.post("/read-all", notificationController.markAllRead);
router.patch(
  "/:notificationId/read",
  validate(notificationIdParamSchema, "params"),
  notificationController.markRead,
);

export { router as notificationRouter };
