import type { Request, Response } from "express";
import { asyncHandler } from "../utils/errors";
import { gmailSendService } from "../services/gmail-send.service";
import type { SendInvestorEmailInput } from "../validators/gmail.schemas";

export const gmailController = {
  sendEmail: asyncHandler(async (req: Request, res: Response) => {
    const { startupId, investorId } = req.params as { startupId: string; investorId: string };
    const result = await gmailSendService.sendInvestorEmail(
      startupId,
      investorId,
      req.user!.userId,
      req.body as SendInvestorEmailInput,
    );
    res.status(201).json({ data: result });
  }),
};
