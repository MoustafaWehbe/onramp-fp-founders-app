import type { Response } from "express";
import { asyncHandler } from "../utils/errors";
import {
  clearReviewerSessionCookie,
  reviewerPortalService,
  setReviewerSessionCookie,
} from "../services/reviewer-portal.service";
import type {
  ReviewerAccessInput,
  ReviewerCommentInput,
  ReviewerVerifyInput,
} from "../validators/reviewer-portal.schemas";

export const reviewerPortalController = {
  requestAccess: asyncHandler(async (req, res) => {
    const result = await reviewerPortalService.requestAccess(req.body as ReviewerAccessInput, {
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    res.json({ data: result });
  }),

  verifyAccess: asyncHandler(async (req, res: Response) => {
    const result = await reviewerPortalService.verifyAccess(req.body as ReviewerVerifyInput, {
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    setReviewerSessionCookie(res, result.rawSessionToken);
    res.json({ data: { session: result.session } });
  }),

  getWorkspace: asyncHandler(async (req, res) => {
    const result = await reviewerPortalService.getWorkspace(req.reviewer!.invitationId);
    res.json({ data: result });
  }),

  getFileAccess: asyncHandler(async (req, res) => {
    const disposition = req.query.disposition === "download" ? "download" : "preview";
    const result = await reviewerPortalService.getFileAccess(
      req.reviewer!.invitationId,
      req.params.documentId as string,
      req.reviewer!.allowDownload,
      disposition,
    );
    res.json({ data: result });
  }),

  listComments: asyncHandler(async (req, res) => {
    const documentId =
      typeof req.query.documentId === "string" ? req.query.documentId : undefined;
    const result = await reviewerPortalService.listComments(
      req.reviewer!.sessionId,
      req.reviewer!.startupId,
      documentId,
    );
    res.json(result);
  }),

  createComment: asyncHandler(async (req, res) => {
    const comment = await reviewerPortalService.createComment(
      req.reviewer!.sessionId,
      req.reviewer!.startupId,
      req.reviewer!.invitationId,
      req.body as ReviewerCommentInput,
    );
    res.status(201).json({ data: comment });
  }),

  complete: asyncHandler(async (req, res) => {
    await reviewerPortalService.complete(req.reviewer!.invitationId);
    res.status(204).send();
  }),

  logout: asyncHandler(async (req, res: Response) => {
    await reviewerPortalService.logout(req.reviewer!.sessionId);
    clearReviewerSessionCookie(res);
    res.status(204).send();
  }),
};
