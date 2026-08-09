import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { validate } from "../utils/validate";
import { authenticate } from "../middleware/auth";
import { authRateLimiter, credentialRateLimiter } from "../middleware/rate-limiter";
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
// Credential checks below use credentialRateLimiter: only failed attempts are
// counted, so signing in successfully never walks someone toward a lockout.
router.post(
  "/register/verify",
  credentialRateLimiter,
  validate(registerVerifySchema),
  authController.registerVerify,
);
router.post("/login", credentialRateLimiter, validate(loginSchema), authController.login);
router.post("/google", credentialRateLimiter, validate(googleAuthSchema), authController.googleAuth);
router.post("/refresh", authController.refresh);
router.post("/forgot-password", authRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", credentialRateLimiter, validate(resetPasswordSchema), authController.resetPassword);
router.post("/logout", credentialRateLimiter, authenticate, authController.logout);
router.get("/me", authenticate, authController.me);

export { router as authRouter };
