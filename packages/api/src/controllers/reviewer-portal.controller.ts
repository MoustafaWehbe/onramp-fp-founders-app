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
  ReviewerEventInput,
  ReviewerPageParams,
  ReviewerPageQuery,
  ReviewerTelemetryInput,
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

  acceptNda: asyncHandler(async (req, res) => {
    await reviewerPortalService.acceptNda(
      req.reviewer!.invitationId,
      req.reviewer!.startupId,
      req.reviewer!.sessionId,
    );
    res.status(204).send();
  }),

  getPageManifest: asyncHandler(async (req, res) => {
    const result = await reviewerPortalService.getPageManifest(
      req.reviewer!.invitationId,
      req.reviewer!.sessionId,
      req.params.versionId as string,
      req.reviewer!.startupId,
      { requireNda: req.reviewer!.requireNda, ndaAccepted: req.reviewer!.ndaAccepted },
    );
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.json({ data: result });
  }),

  getPageImage: asyncHandler(async (req, res) => {
    const { versionId, pageNumber } = req.params as unknown as ReviewerPageParams;
    const { t, kind } = req.query as unknown as ReviewerPageQuery;

    const { body, contentType } = await reviewerPortalService.getPageImage({
      invitationId: req.reviewer!.invitationId,
      sessionId: req.reviewer!.sessionId,
      versionId,
      pageNumber,
      token: t,
      kind,
      email: req.reviewer!.email,
      watermarkEnabled: req.reviewer!.watermarkEnabled,
      requireNda: req.reviewer!.requireNda,
      ndaAccepted: req.reviewer!.ndaAccepted,
    });

    // no-store keeps page images out of the browser's on-disk cache, so there
    // is no cached copy for the viewer to recover after the session ends.
    res.set({
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Cache-Control": "private, no-store, max-age=0",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(body);
  }),

  getDownload: asyncHandler(async (req, res) => {
    const { body, mimeType, originalFilename } = await reviewerPortalService.getDownload({
      invitationId: req.reviewer!.invitationId,
      startupId: req.reviewer!.startupId,
      sessionId: req.reviewer!.sessionId,
      allowDownload: req.reviewer!.allowDownload,
      watermarkEnabled: req.reviewer!.watermarkEnabled,
      requireNda: req.reviewer!.requireNda,
      ndaAccepted: req.reviewer!.ndaAccepted,
      versionId: req.params.versionId as string,
      email: req.reviewer!.email,
    });

    res.set({
      "Content-Type": mimeType,
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(originalFilename)}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(body);
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

  logEvent: asyncHandler(async (req, res) => {
    await reviewerPortalService.logEvent(
      req.reviewer!.startupId,
      req.reviewer!.invitationId,
      req.reviewer!.sessionId,
      req.body as ReviewerEventInput,
    );
    res.status(204).send();
  }),

  recordTelemetry: asyncHandler(async (req, res) => {
    await reviewerPortalService.recordTelemetry(
      req.reviewer!.startupId,
      req.reviewer!.invitationId,
      req.reviewer!.sessionId,
      req.body as ReviewerTelemetryInput,
    );
    res.status(204).send();
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
