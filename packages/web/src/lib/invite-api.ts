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
 * POST /invites/accept is public and has two success shapes:
 * 200 — the membership was activated;
 * 202 — nobody has registered with the invited email yet. The invite stays
 * pending and registration claims it automatically, so there is nothing left
 * to accept afterwards.
 */
export type AcceptInviteResult =
  | { status: "accepted"; member: AcceptedMembership }
  | { status: "requires_registration"; email: string };

type AcceptInviteResponse =
  | { data: AcceptedMembership }
  | { requiresRegistration: true; email: string };

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const { data } = await apiClient.post<AcceptInviteResponse>("/invites/accept", { token });

  if ("requiresRegistration" in data) {
    return { status: "requires_registration", email: data.email };
  }

  return { status: "accepted", member: data.data };
}
