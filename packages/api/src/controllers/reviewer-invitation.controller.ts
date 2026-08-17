import { asyncHandler } from "../utils/errors";
import { reviewerInvitationService } from "../services/reviewer-invitation.service";
import type {
  CreateReviewerInvitationInput,
  ListReviewerInvitationsQuery,
} from "../validators/reviewer.schemas";

export const reviewerInvitationController = {
  listInvitations: asyncHandler(async (req, res) => {
    const result = await reviewerInvitationService.listInvitations(
      req.params.startupId as string,
      req.query as unknown as ListReviewerInvitationsQuery,
    );
    res.json(result);
  }),

  createInvitation: asyncHandler(async (req, res) => {
    const result = await reviewerInvitationService.createInvitation(
      req.params.startupId as string,
      req.user!.userId,
      req.body as CreateReviewerInvitationInput,
    );
    res.status(201).json({ data: result });
  }),

  getAnalytics: asyncHandler(async (req, res) => {
    const result = await reviewerInvitationService.getInvitationAnalytics(
      req.params.startupId as string,
      req.params.invitationId as string,
    );
    res.json({ data: result });
  }),

  revokeInvitation: asyncHandler(async (req, res) => {
    await reviewerInvitationService.revokeInvitation(
      req.params.startupId as string,
      req.params.invitationId as string,
      req.user!.userId,
    );
    res.status(204).send();
  }),
};
