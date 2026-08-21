import type { RequestHandler } from "express";
import { getAiConfig } from "../config/ai";
import { createError } from "../utils/errors";

/** Keeps AI independently disableable without disabling the rest of the app. */
export const requireAiEnabled: RequestHandler = (_req, _res, next) => {
  if (!getAiConfig().enabled) return next(createError("AI is currently unavailable", 503, "AI_DISABLED"));
  return next();
};
