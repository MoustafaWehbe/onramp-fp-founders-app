import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validate } from "../utils/validate";
import { createStartupSchema } from "../validators/startup.schemas";
import { startupController } from "../controllers/startup.controller";

const router = Router();

// POST /api/v1/startups
// authenticate only — the caller has no membership yet (they're creating the startup)
router.post(
  "/",
  authenticate,
  validate(createStartupSchema),
  startupController.createStartup,
);

export { router as startupRouter };
