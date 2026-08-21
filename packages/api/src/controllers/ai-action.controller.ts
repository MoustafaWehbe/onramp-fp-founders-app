import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { asyncHandler } from "../utils/errors";
import { aiActionsService } from "../services/ai-actions.service";
import { emailSendRateLimiter, scheduleMeetingRateLimiter } from "../middleware/rate-limiter";
import type { ApproveAiActionInput } from "../validators/ai-action.schemas";

/** Runs an Express rate-limit middleware from inside a handler, so it can be applied conditionally on the row's actionType rather than unconditionally on the route. */
function runLimiter(limiter: (req: Request, res: Response, next: NextFunction) => void, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    limiter(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
  });
}

export const aiActionController = {
  approve: asyncHandler(async (req, res) => {
    const startupId = req.params.startupId as string;
    const actionId = req.params.actionId as string;
    // Shares the same hourly budget as the manual Send/Schedule buttons — a
    // founder cannot bypass their rate limit by routing through the copilot.
    const pending = await prisma.aiAgentAction.findFirst({ where: { id: actionId, startupId }, select: { actionType: true } });
    if (pending?.actionType === "send_investor_email") await runLimiter(emailSendRateLimiter, req, res);
    if (pending?.actionType === "schedule_meeting") await runLimiter(scheduleMeetingRateLimiter, req, res);
    if (res.headersSent) return; // the rate limiter already wrote its own 429 response

    const input = req.body as ApproveAiActionInput;
    const outcome = await aiActionsService.approveAction(startupId, req.user!.userId, req.member!.roleId, actionId, input.payload);
    res.json({ data: outcome });
  }),
  reject: asyncHandler(async (req, res) => {
    const action = await aiActionsService.rejectAction(req.params.startupId as string, req.params.actionId as string);
    res.json({ data: action });
  }),
};
