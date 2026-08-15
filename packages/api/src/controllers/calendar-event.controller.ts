import type { Request, Response } from "express";
import { asyncHandler } from "../utils/errors";
import { calendarEventService } from "../services/calendar-event.service";
import type { ScheduleMeetingSchemaInput } from "../validators/calendar-event.schemas";

export const calendarEventController = {
  scheduleMeeting: asyncHandler(async (req: Request, res: Response) => {
    const { startupId, investorId } = req.params as { startupId: string; investorId: string };
    const result = await calendarEventService.scheduleMeeting(
      startupId,
      investorId,
      req.user!.userId,
      req.body as ScheduleMeetingSchemaInput,
    );
    res.status(201).json({ data: result });
  }),
};
