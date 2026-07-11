import { Router } from "express";
import { authRouter } from "./auth.routes";
import { startupRouter } from "./startup.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/startups", startupRouter);

export { router };
