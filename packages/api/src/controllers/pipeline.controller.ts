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
    );
    res.status(201).json({ data: entry });
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
};
