import { asyncHandler } from "../utils/errors";
import { interactionLogService } from "../services/interaction-log.service";
import { notificationService } from "../services/notification.service";
import type {
  CreateInteractionLogInput,
  UpdateInteractionLogInput,
  ListInteractionLogQuery,
} from "../validators/interaction-log.schemas";

export const interactionLogController = {
  createLog: asyncHandler(async (req, res) => {
    const result = await interactionLogService.createLog(
      req.params.startupId as string,
      req.body as CreateInteractionLogInput,
      req.user!.userId,
    );
    res.status(201).json(result);
  }),

  listLogs: asyncHandler(async (req, res) => {
    const result = await interactionLogService.listLogs(
      req.params.startupId as string,
      req.query as unknown as ListInteractionLogQuery,
    );
    res.json(result);
  }),

  getLog: asyncHandler(async (req, res) => {
    const result = await interactionLogService.getLog(
      req.params.startupId as string,
      req.params.logId as string,
    );
    res.json(result);
  }),

  updateLog: asyncHandler(async (req, res) => {
    const logId = req.params.logId as string;
    const input = req.body as UpdateInteractionLogInput;
    const result = await interactionLogService.updateLog(
      req.params.startupId as string,
      logId,
      input,
    );

    // Completing or rescheduling clears whatever "this is overdue" notification
    // is sitting on the old due date — a fresh one fires later if the new date
    // also passes unattended.
    if (input.followupCompletedAt !== undefined || input.nextFollowupDate !== undefined) {
      void notificationService.clearFollowupNotifications([logId]);
    }

    res.json(result);
  }),

  deleteLog: asyncHandler(async (req, res) => {
    const logId = req.params.logId as string;
    await interactionLogService.deleteLog(req.params.startupId as string, logId);
    void notificationService.clearFollowupNotifications([logId]);
    res.json({ message: "Interaction log removed" });
  }),

  listLogsByInvestor: asyncHandler(async (req, res) => {
    const result = await interactionLogService.listLogsByInvestor(
      req.params.startupId as string,
      req.params.investorId as string,
      req.query as unknown as ListInteractionLogQuery,
    );
    res.json(result);
  }),

  listLogsByPipeline: asyncHandler(async (req, res) => {
    const result = await interactionLogService.listLogsByPipeline(
      req.params.startupId as string,
      req.params.pipelineId as string,
      req.query as unknown as ListInteractionLogQuery,
    );
    res.json(result);
  }),
};