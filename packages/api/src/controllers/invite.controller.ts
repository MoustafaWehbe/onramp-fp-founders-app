import { asyncHandler } from "../utils/errors";
import { logger } from "../utils/logger";
import { inviteService } from "../services/invite.service";
import { notificationService } from "../services/notification.service";
import { prisma } from "../db/prisma";
import { emailQueue } from "../jobs/queue";
import { inviteEmail } from "../emails/templates/invite";
import { getAppUrl } from "../config/env";
import type { InviteMemberInput, AcceptInviteInput, ChangeRoleInput } from "../validators/invite.schemas";

/**
 * Builds and enqueues the invitation email.
 *
 * The membership row is already committed by the time this runs, so a queue
 * outage must not fail the request it reports back instead, and the caller
 * tells the inviter the mail never went out.
 */
async function queueInviteEmail(
  startupId: string,
  to: string,
  rawToken: string,
  context: string,
): Promise<{ queued: boolean; startupName: string }> {
  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { name: true },
  });
  const startupName = startup?.name ?? "this startup";

  const inviteLink = `${getAppUrl()}/accept-invite?token=${rawToken}`;
  const { subject, html } = inviteEmail(startupName, inviteLink);

  try {
    await emailQueue.add("send-invite", { to, subject, html });
    return { queued: true, startupName };
  } catch (err) {
    logger.error({ err, context }, "email enqueue failed");
    return { queued: false, startupName };
  }
}

export const inviteController = {
  inviteMember: asyncHandler(async (req, res) => {
    const input = req.body as InviteMemberInput;
    const startupId = req.params.startupId as string;
    const inviterUserId = req.user!.userId;

    const { rawToken, member, roleName } = await inviteService.inviteMember(
      input,
      startupId,
      inviterUserId,
      req.member!.id,
    );

    const { queued: emailQueued, startupName } = await queueInviteEmail(
      startupId,
      input.email,
      rawToken,
      "inviteMember",
    );

    // An invitee who already has an account may well be signed in right now —
    // the in-app notification lets them accept without hunting for the email.
    await notificationService.notifyInvitedUser({
      email: input.email,
      startupId,
      startupName,
      roleName,
      memberId: member.id,
    });

    res.status(201).json({
      message: emailQueued ? "Invitation sent" : "Invitation created, but the email failed to send",
      emailQueued,
    });
  }),

  listMyInvites: asyncHandler(async (req, res) => {
    const data = await inviteService.listMyInvites(req.user!.userId);
    res.json({ data });
  }),

  acceptMyInvite: asyncHandler(async (req, res) => {
    const memberId = req.params.memberId as string;
    const userId = req.user!.userId;

    const member = await inviteService.acceptMyInvite(memberId, userId);
    await notificationService.clearInviteNotification(memberId, userId);

    res.json({ data: member });
  }),

  declineMyInvite: asyncHandler(async (req, res) => {
    const memberId = req.params.memberId as string;
    const userId = req.user!.userId;

    await inviteService.declineMyInvite(memberId, userId);
    await notificationService.clearInviteNotification(memberId, userId);

    res.status(204).send();
  }),

  resendInvite: asyncHandler(async (req, res) => {
    const startupId = req.params.startupId as string;
    const memberId = req.params.memberId as string;

    const { rawToken, email } = await inviteService.resendInvite(startupId, memberId);
    const { queued: emailQueued } = await queueInviteEmail(
      startupId,
      email,
      rawToken,
      "resendInvite",
    );

    res.json({
      message: emailQueued
        ? "Invitation resent"
        : "A new invitation link was issued, but the email failed to send",
      emailQueued,
    });
  }),

  acceptInvite: asyncHandler(async (req, res) => {
    const input = req.body as AcceptInviteInput;
    const result = await inviteService.acceptInvite(input, req.user?.userId ?? null);

    // 202 the invitation is untouched and still pending; the caller has to
    // sign in or register as the invited person before it can be accepted.
    if ("requiresRegistration" in result || "requiresLogin" in result) {
      res.status(202).json(result);
      return;
    }

    if ("emailMismatch" in result) {
      res.status(403).json({
        code: "EMAIL_MISMATCH",
        error: "This invitation was issued to a different email address",
        invitedEmail: result.invitedEmail,
        signedInAs: result.signedInAs,
      });
      return;
    }

    res.json(result);
  }),

  changeRole: asyncHandler(async (req, res) => {
    const startupId = req.params.startupId as string;
    const memberId = req.params.memberId as string;
    const input = req.body as ChangeRoleInput;
    const result = await inviteService.changeRole(
      startupId,
      memberId,
      input,
      req.member!.id,
      req.user!.userId,
    );
    res.json(result);
  }),

  removeMember: asyncHandler(async (req, res) => {
    const startupId = req.params.startupId as string;
    const memberId = req.params.memberId as string;
    await inviteService.removeMember(startupId, memberId, req.user!.userId);
    res.status(204).send();
  }),
};
