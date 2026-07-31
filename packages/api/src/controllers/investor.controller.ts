import { asyncHandler } from "../utils/errors";
import { investorService } from "../services/investor.service";
import type {
  CreateInvestorInput,
  UpdateInvestorInput,
  ListInvestorsQuery,
} from "../validators/investor.schemas";

export const investorController = {
  createInvestor: asyncHandler(async (req, res) => {
    const investor = await investorService.createInvestor(
      req.params.startupId as string,
      req.body as CreateInvestorInput,
    );
    res.status(201).json({ data: investor });
  }),

  listInvestors: asyncHandler(async (req, res) => {
    const result = await investorService.listInvestors(
      req.params.startupId as string,
      req.query as unknown as ListInvestorsQuery,
    );
    res.json(result);
  }),

  getInvestor: asyncHandler(async (req, res) => {
    const investor = await investorService.getInvestor(
      req.params.startupId as string,
      req.params.investorId as string,
    );
    res.json({ data: investor });
  }),

  updateInvestor: asyncHandler(async (req, res) => {
    const investor = await investorService.updateInvestor(
      req.params.startupId as string,
      req.params.investorId as string,
      req.body as UpdateInvestorInput,
    );
    res.json({ data: investor });
  }),

  deleteInvestor: asyncHandler(async (req, res) => {
    await investorService.deleteInvestor(
      req.params.startupId as string,
      req.params.investorId as string,
    );
    res.json({ message: "Investor removed" });
  }),
};
