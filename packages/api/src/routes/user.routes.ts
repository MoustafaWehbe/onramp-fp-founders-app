import { Router } from "express";
import { userController } from "../controllers/user.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../utils/validate";
import { updateUserSchema } from "../validators/user.schemas";

const router = Router();

router.patch("/me", authenticate, validate(updateUserSchema), userController.updateMe);

export { router as userRouter };
