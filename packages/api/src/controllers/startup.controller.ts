import { asyncHandler } from "../utils/errors";
import { startupService } from "../services/startup.service";
import type { CreateStartupInput } from "../validators/startup.schemas";

export const startupController = {
  createStartup: asyncHandler(async (req, res) => {
    const result = await startupService.createStartup(
      req.body as CreateStartupInput,
      req.user!.userId,
    );
    res.status(201).json({ data: result });
  }),
};
