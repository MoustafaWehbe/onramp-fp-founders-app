import { asyncHandler } from "../utils/errors";
import { pipelineService } from "../services/pipeline.service";
import type {
  CreatePipelineEntryInput,
  UpdatePipelineEntryInput,
  ListPipelineQuery,
} from "../validators/pipeline.schemas";

export const pipelineController = {
  createEntry: asyncHandler(async (req, res) => {
    const entry = await pipelineService.createEntry(
      req.params.startupId as string,
      req.body as CreatePipelineEntryInput,
      req.user!.userId,
    );
    res.status(201).json({ data: entry });
  }),

  getAnalytics: asyncHandler(async (req, res) => {
    const result = await pipelineService.getAnalytics(
      req.params.startupId as string,
      req.query.roundId as string | undefined,
    );
    res.json(result);
  }),

  listEntries: asyncHandler(async (req, res) => {
    const result = await pipelineService.listEntries(
      req.params.startupId as string,
      req.query as unknown as ListPipelineQuery,
    );
    res.json(result);
  }),

  getEntry: asyncHandler(async (req, res) => {
    const entry = await pipelineService.getEntry(
      req.params.startupId as string,
      req.params.pipelineId as string,
    );
    res.json({ data: entry });
  }),

  updateEntry: asyncHandler(async (req, res) => {
    const entry = await pipelineService.updateEntry(
      req.params.startupId as string,
      req.params.pipelineId as string,
      req.body as UpdatePipelineEntryInput,
      req.user!.userId,
    );
    res.json({ data: entry });
  }),

  deleteEntry: asyncHandler(async (req, res) => {
    await pipelineService.deleteEntry(
      req.params.startupId as string,
      req.params.pipelineId as string,
    );
    res.json({ message: "Pipeline entry removed" });
  }),

  listStageEvents: asyncHandler(async (req, res) => {
    const result = await pipelineService.listStageEvents(
      req.params.startupId as string,
      req.params.pipelineId as string,
    );
    res.json(result);
  }),
};
