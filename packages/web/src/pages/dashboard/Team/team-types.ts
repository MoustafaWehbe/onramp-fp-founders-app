import type { StartupMember } from "../../../lib/team-api";
import { formatDate } from "../../../lib/utils";

export type TeamMemberRow = {
  /** Membership id what the role and remove endpoints are keyed by. */
  id: string;
  /** Null until the invite is accepted and an account is attached. */
  userId: string | null;
  name: string;
  email: string;
  role: string;
  status: string;
  isPending: boolean;
  joined: string;
  avatarUrl: string | null;
};

/** Matches the system roles seeded in packages/api/src/config/permissions.ts. */
export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  collaborator: "Collaborator",
  viewer: "Viewer",
};

export const ROLE_HINTS: Record<string, string> = {
  owner: "Full access, including billing and deleting the workspace",
  collaborator: "Can edit the pipeline and documents",
  viewer: "Read-only access",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function mapMemberToRow(member: StartupMember): TeamMemberRow {
  const isPending = member.status !== "active";
  const fullName = member.user ? `${member.user.firstName} ${member.user.lastName}`.trim() : "";

  return {
    id: member.id,
    userId: member.user?.id ?? null,
    // A pending invite has no name to show, so the invited address stands in
    // as the row's identity.
    name: fullName || member.invitedEmail || "Invited teammate",
    email: member.user?.email ?? member.invitedEmail ?? "",
    role: member.role,
    status: member.status,
    isPending,
    joined: member.joinedAt ? formatDate(member.joinedAt) : "—",
    avatarUrl: member.user?.avatarUrl ?? null,
  };
}
