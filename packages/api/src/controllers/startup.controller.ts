import { asyncHandler } from "../utils/errors";
import { startupService } from "../services/startup.service";
import type { CreateStartupInput, UpdateStartupInput } from "../validators/startup.schemas";

export const startupController = {
  createStartup: asyncHandler(async (req, res) => {
    const result = await startupService.createStartup(
      req.body as CreateStartupInput,
      req.user!.userId,
    );
    res.status(201).json({ data: result });
  }),

  getStartup: asyncHandler(async (req, res) => {
    const result = await startupService.getStartup(req.params.startupId, req.user!.userId);
    res.json({ data: result });
  }),

  updateStartup: asyncHandler(async (req, res) => {
    const startup = await startupService.updateStartup(
      req.params.startupId,
      req.body as UpdateStartupInput,
    );
    res.json({ data: { startup } });
  }),

  deleteStartup: asyncHandler(async (req, res) => {
    await startupService.deleteStartup(req.params.startupId);
    res.status(204).send();
  }),

  listMembers: asyncHandler(async (req, res) => {
    const members = await startupService.listMembers(req.params.startupId);
    res.json({ data: { members } });
  }),
};
