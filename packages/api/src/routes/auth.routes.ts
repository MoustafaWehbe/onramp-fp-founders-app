import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { validate } from "../utils/validate";
import { authenticate } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rate-limiter";
import { registerInitiateSchema, registerResendSchema, registerVerifySchema, loginSchema, googleAuthSchema, forgotPasswordSchema, resetPasswordSchema } from "../validators/auth.schemas";

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
router.post("/google", authRateLimiter, validate(googleAuthSchema), authController.googleAuth);
router.post("/refresh", authController.refresh);
router.post("/forgot-password", authRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", authRateLimiter, validate(resetPasswordSchema), authController.resetPassword);
router.post("/logout", authRateLimiter, authenticate, authController.logout);
router.get("/me", authenticate, authController.me);

export { router as authRouter };
