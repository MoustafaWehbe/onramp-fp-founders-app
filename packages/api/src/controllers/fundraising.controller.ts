import { asyncHandler } from "../utils/errors";
import { fundraisingService } from "../services/fundraising.service";
import type {
  CreateCommitmentInput,
  CreateFundraisingRoundInput,
  ListCommitmentsQuery,
  ListFundraisingRoundsQuery,
  UpdateCommitmentInput,
  UpdateFundraisingRoundInput,
} from "../validators/fundraising.schemas";

export const fundraisingController = {
  listRounds: asyncHandler(async (req, res) => {
    res.json(await fundraisingService.listRounds(req.params.startupId as string, req.query as unknown as ListFundraisingRoundsQuery));
  }),
  getRound: asyncHandler(async (req, res) => {
    res.json({ data: await fundraisingService.getRound(req.params.startupId as string, req.params.roundId as string) });
  }),
  createRound: asyncHandler(async (req, res) => {
    const round = await fundraisingService.createRound(
      req.params.startupId as string,
      req.body as CreateFundraisingRoundInput,
      req.user!.userId,
    );
    res.status(201).json({ data: round });
  }),
  updateRound: asyncHandler(async (req, res) => {
    const round = await fundraisingService.updateRound(
      req.params.startupId as string,
      req.params.roundId as string,
      req.body as UpdateFundraisingRoundInput,
      req.user!.userId,
    );
    res.json({ data: round });
  }),
  deleteRound: asyncHandler(async (req, res) => {
    await fundraisingService.deleteRound(req.params.startupId as string, req.params.roundId as string, req.user!.userId);
    res.json({ message: "Fundraising round removed" });
  }),
  getRoundMetrics: asyncHandler(async (req, res) => {
    res.json({
      data: await fundraisingService.getRoundMetrics(
        req.params.startupId as string,
        req.params.roundId as string,
      ),
    });
  }),
  getFundingHistory: asyncHandler(async (req, res) => {
    res.json({
      data: await fundraisingService.getFundingHistory(
        req.params.startupId as string,
        req.params.roundId as string,
      ),
    });
  }),
  listRoundCommitments: asyncHandler(async (req, res) => {
    res.json(await fundraisingService.listCommitments(req.params.startupId as string, req.query as unknown as ListCommitmentsQuery, req.params.roundId as string));
  }),
  listCommitments: asyncHandler(async (req, res) => {
    res.json(await fundraisingService.listCommitments(req.params.startupId as string, req.query as unknown as ListCommitmentsQuery));
  }),
  getCommitment: asyncHandler(async (req, res) => {
    res.json({ data: await fundraisingService.getCommitment(req.params.startupId as string, req.params.commitmentId as string) });
  }),
  createCommitment: asyncHandler(async (req, res) => {
    const commitment = await fundraisingService.createCommitment(req.params.startupId as string, req.body as CreateCommitmentInput, req.user!.userId);
    res.status(201).json({ data: commitment });
  }),
  updateCommitment: asyncHandler(async (req, res) => {
    const commitment = await fundraisingService.updateCommitment(req.params.startupId as string, req.params.commitmentId as string, req.body as UpdateCommitmentInput, req.user!.userId);
    res.json({ data: commitment });
  }),
  deleteCommitment: asyncHandler(async (req, res) => {
    await fundraisingService.deleteCommitment(req.params.startupId as string, req.params.commitmentId as string, req.user!.userId);
    res.json({ message: "Commitment removed" });
  }),
};
