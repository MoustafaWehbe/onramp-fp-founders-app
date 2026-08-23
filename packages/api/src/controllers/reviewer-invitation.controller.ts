import { asyncHandler } from "../utils/errors";
import { reviewerInvitationService } from "../services/reviewer-invitation.service";
import type {
  CreateReviewerInvitationInput,
  ListFounderReviewerCommentsQuery,
  ListReviewerInvitationsQuery,
  ReviewerActivityQuery,
} from "../validators/reviewer.schemas";
import { reviewerCommentService } from "../services/reviewer-comment.service";
import { reviewerActivityService } from "../services/reviewer-activity.service";

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

  resendInvitation: asyncHandler(async (req, res) => {
    const result = await reviewerInvitationService.resendInvitation(
      req.params.startupId as string,
      req.params.invitationId as string,
      req.user!.userId,
    );
    res.json({ data: result });
  }),

  listComments: asyncHandler(async (req, res) => {
    const result = await reviewerCommentService.list(
      req.params.startupId as string,
      req.query as unknown as ListFounderReviewerCommentsQuery,
    );
    res.json(result);
  }),

  markCommentRead: asyncHandler(async (req, res) => {
    await reviewerCommentService.markRead(
      req.params.startupId as string,
      req.params.commentId as string,
    );
    res.status(204).send();
  }),

  resolveComment: asyncHandler(async (req, res) => {
    await reviewerCommentService.resolve(
      req.params.startupId as string,
      req.params.commentId as string,
      req.user!.userId,
    );
    res.status(204).send();
  }),

  getAnalytics: asyncHandler(async (req, res) => {
    const result = await reviewerInvitationService.getInvitationAnalytics(
      req.params.startupId as string,
      req.params.invitationId as string,
    );
    res.json({ data: result });
  }),

  listActivity: asyncHandler(async (req, res) => {
    const activity = await reviewerActivityService.list(
      req.params.startupId as string,
      req.params.invitationId as string,
      (req.query as unknown as ReviewerActivityQuery).limit,
    );
    res.json({ data: activity });
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
