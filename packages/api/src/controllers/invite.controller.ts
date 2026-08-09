import { asyncHandler } from "../utils/errors";
import { inviteService } from "../services/invite.service";
import { prisma } from "../db/prisma";
import { emailQueue } from "../jobs/queue";
import { inviteEmail } from "../emails/templates/invite";
import { getAppUrl } from "../config/env";
import type { InviteMemberInput, AcceptInviteInput, ChangeRoleInput } from "../validators/invite.schemas";

/**
 * Builds and enqueues the invitation email.
 *
 * The membership row is already committed by the time this runs, so a queue
 * outage must not fail the request — it reports back instead, and the caller
 * tells the inviter the mail never went out.
 */
async function queueInviteEmail(
  startupId: string,
  to: string,
  rawToken: string,
  context: string,
): Promise<boolean> {
  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { name: true },
  });

  const inviteLink = `${getAppUrl()}/accept-invite?token=${rawToken}`;
  const { subject, html } = inviteEmail(startup?.name ?? "this startup", inviteLink);

  try {
    await emailQueue.add("send-invite", { to, subject, html });
    return true;
  } catch (err) {
    console.error(`[${context}] email enqueue failed:`, err);
    return false;
  }
}

export const inviteController = {
  inviteMember: asyncHandler(async (req, res) => {
    const input = req.body as InviteMemberInput;
    const startupId = req.params.startupId as string;
    const inviterUserId = req.user!.userId;

    const { rawToken } = await inviteService.inviteMember(input, startupId, inviterUserId, req.member!.id);

    const emailQueued = await queueInviteEmail(startupId, input.email, rawToken, "inviteMember");

    res.status(201).json({
      message: emailQueued ? "Invitation sent" : "Invitation created, but the email failed to send",
      emailQueued,
    });
  }),

  resendInvite: asyncHandler(async (req, res) => {
    const startupId = req.params.startupId as string;
    const memberId = req.params.memberId as string;

    const { rawToken, email } = await inviteService.resendInvite(startupId, memberId);
    const emailQueued = await queueInviteEmail(startupId, email, rawToken, "resendInvite");

    res.json({
      message: emailQueued
        ? "Invitation resent"
        : "A new invitation link was issued, but the email failed to send",
      emailQueued,
    });
  }),

  acceptInvite: asyncHandler(async (req, res) => {
    const input = req.body as AcceptInviteInput;
    const result = await inviteService.acceptInvite(input);

    if ("requiresRegistration" in result) {
      res.status(202).json(result);
      return;
    }

    res.json(result);
  }),

  changeRole: asyncHandler(async (req, res) => {
    const startupId = req.params.startupId as string;
    const memberId = req.params.memberId as string;
    const input = req.body as ChangeRoleInput;
    const result = await inviteService.changeRole(startupId, memberId, input, req.member!.id);
    res.json(result);
  }),

  removeMember: asyncHandler(async (req, res) => {
    const startupId = req.params.startupId as string;
    const memberId = req.params.memberId as string;
    await inviteService.removeMember(startupId, memberId, req.user!.userId);
    res.status(204).send();
  }),
};
