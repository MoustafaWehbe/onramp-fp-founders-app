import { apiClient } from "./api-client";

export type StartupRole = {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
};

export type MemberUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
};

/**
 * Two shapes come back from the members endpoint: someone who has accepted
 * carries `user`, while a pending invite carries `invitedEmail` and has no
 * account attached to it yet.
 */
export type StartupMember = {
  id: string;
  status: string;
  role: string;
  joinedAt: string | null;
  createdAt: string;
  user?: MemberUser;
  invitedEmail?: string | null;
};

export type MembershipRecord = {
  id: string;
  startupId: string;
  userId: string | null;
  roleId: string;
  status: string;
};

export async function listMembers(startupId: string) {
  const { data } = await apiClient.get<{ data: { members: StartupMember[] } }>(
    `/startups/${startupId}/members`,
  );
  return data.data.members;
}

export async function listRoles(startupId: string) {
  const { data } = await apiClient.get<{ data: { roles: StartupRole[] } }>(
    `/startups/${startupId}/roles`,
  );
  return data.data.roles;
}

/**
 * `emailQueued: false` means the membership row was created but the invitation
 * email never left — the caller has to tell the inviter to follow up manually.
 */
export async function inviteMember(startupId: string, body: { email: string; roleId: string }) {
  const { data } = await apiClient.post<{ message: string; emailQueued: boolean }>(
    `/startups/${startupId}/invites`,
    body,
  );
  return data;
}

export async function changeMemberRole(startupId: string, memberId: string, roleId: string) {
  const { data } = await apiClient.patch<{ data: MembershipRecord }>(
    `/startups/${startupId}/members/${memberId}/role`,
    { roleId },
  );
  return data.data;
}

export async function removeMember(startupId: string, memberId: string) {
  await apiClient.delete(`/startups/${startupId}/members/${memberId}`);
}
