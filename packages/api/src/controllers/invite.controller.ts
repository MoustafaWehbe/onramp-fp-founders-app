import { asyncHandler } from "../utils/errors";
import { inviteService } from "../services/invite.service";
import { emailQueue } from "../jobs/queue";
import { inviteEmail } from "../emails/templates/invite";
import type { InviteMemberInput, AcceptInviteInput, ChangeRoleInput } from "../validators/invite.schemas";

export const inviteController = {
  inviteMember: asyncHandler(async (req, res) => {
    const input = req.body as InviteMemberInput;
    const startupId = req.params.startupId as string;
    const inviterUserId = req.user!.userId;

    const { rawToken } = await inviteService.inviteMember(input, startupId, inviterUserId);

    // Enqueue invitation email — follows existing email queue pattern
    const startup = await import("../db/prisma").then((m) =>
      m.prisma.startup.findUnique({
        where: { id: startupId },
        select: { name: true },
      }),
    );

    const inviteLink = `${process.env.CORS_ORIGIN}/accept-invite?token=${rawToken}`;
    const { subject, html } = inviteEmail(startup?.name ?? "this startup", inviteLink);

    try {
      await emailQueue.add("send-invite", {
        to: input.email,
        subject,
        html,
      });
    } catch (err) {
      console.error("[inviteMember] email enqueue failed:", err);
    }

    res.status(201).json({ message: "Invitation sent" });
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
