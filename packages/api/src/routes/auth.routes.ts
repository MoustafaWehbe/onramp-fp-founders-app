import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { validate } from "../utils/validate";
import { authenticate } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rate-limiter";
import { registerInitiateSchema, registerResendSchema, registerVerifySchema, loginSchema } from "../validators/auth.schemas";

const router = Router();

router.post(
  "/register/initiate",
  authRateLimiter,
  validate(registerInitiateSchema),
  authController.registerInitiate,
);
router.post(
  "/register/resend",
  authRateLimiter,
  validate(registerResendSchema),
  authController.registerResend,
);
router.post(
  "/register/verify",
  authRateLimiter,
  validate(registerVerifySchema),
  authController.registerVerify,
);
router.post("/login", authRateLimiter, validate(loginSchema), authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.me);

export { router as authRouter };
