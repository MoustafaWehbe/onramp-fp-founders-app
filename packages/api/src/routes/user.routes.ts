import { Router } from "express";
import { userController } from "../controllers/user.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../utils/validate";
import { updateUserSchema } from "../validators/user.schemas";

const router = Router();

router.patch("/me", authenticate, validate(updateUserSchema), userController.updateMe);

// PUT is registered directly in app.ts (raw body, ahead of express.json()).
router.delete("/me/avatar", authenticate, userController.removeAvatar);

export { router as userRouter };
