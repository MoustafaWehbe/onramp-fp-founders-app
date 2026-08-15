import { apiClient } from "./api-client";

export type StartupRole = {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: string[];
  memberCount: number;
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

export async function createRole(
  startupId: string,
  input: { name: string; description?: string; permissions: string[] },
) {
  const { data } = await apiClient.post<{ data: { role: StartupRole } }>(
    `/startups/${startupId}/roles`,
    input,
  );
  return data.data.role;
}

export async function updateRole(
  startupId: string,
  roleId: string,
  input: { description?: string; permissions?: string[] },
) {
  const { data } = await apiClient.patch<{ data: { role: StartupRole } }>(
    `/startups/${startupId}/roles/${roleId}`,
    input,
  );
  return data.data.role;
}

export async function deleteRole(startupId: string, roleId: string) {
  await apiClient.delete(`/startups/${startupId}/roles/${roleId}`);
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

/**
 * Issues a fresh invite link and emails it again. The previous link stops
 * working — only its hash was stored, so it cannot be re-sent, only replaced.
 * Fails with 409 ALREADY_ACCEPTED if the person has since joined.
 */
export async function resendInvite(startupId: string, memberId: string) {
  const { data } = await apiClient.post<{ message: string; emailQueued: boolean }>(
    `/startups/${startupId}/invites/${memberId}/resend`,
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
