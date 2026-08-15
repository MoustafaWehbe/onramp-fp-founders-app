import { apiClient } from "./api-client";

export type AcceptedMembership = {
  id: string;
  startupId: string;
  userId: string;
  roleId: string;
  status: string;
  joinedAt: string | null;
  createdAt: string;
};

/**
 * POST /invites/accept is reachable signed-out, but only ever activates the
 * membership for a signed-in user whose email matches the invitation. It has
 * two success shapes:
 * 200 the membership was activated (or already belonged to this user);
 * 202 the invitation is untouched because nobody is signed in as the invited
 * person yet, either because they have no account or because they are signed
 * out. Registration claims a pending invite automatically.
 */
export type AcceptInviteResult =
  | { status: "accepted"; member: AcceptedMembership }
  | { status: "requires_registration"; email: string }
  | { status: "requires_login"; email: string };

type AcceptInviteResponse =
  | { data: AcceptedMembership }
  | { requiresRegistration: true; email: string }
  | { requiresLogin: true; email: string };

/** An invitation waiting for the signed-in user, acceptable without the email. */
export type PendingInvite = {
  id: string;
  createdAt: string;
  inviteExpiresAt: string | null;
  startup: { id: string; name: string; industry: string; fundingStage: string };
  role: { id: string; name: string };
  inviter: { firstName: string; lastName: string; email: string } | null;
};

export async function listMyInvites(): Promise<PendingInvite[]> {
  const { data } = await apiClient.get<{ data: PendingInvite[] }>("/invites/mine");
  return data.data;
}

export async function acceptMyInvite(memberId: string): Promise<AcceptedMembership> {
  const { data } = await apiClient.post<{ data: AcceptedMembership }>(
    `/invites/mine/${memberId}/accept`,
  );
  return data.data;
}

export async function declineMyInvite(memberId: string): Promise<void> {
  await apiClient.post(`/invites/mine/${memberId}/decline`);
}

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const { data } = await apiClient.post<AcceptInviteResponse>("/invites/accept", { token });

  if ("requiresRegistration" in data) {
    return { status: "requires_registration", email: data.email };
  }

  if ("requiresLogin" in data) {
    return { status: "requires_login", email: data.email };
  }

  return { status: "accepted", member: data.data };
}
