import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import type { AuthUser } from "../../providers/AuthProvider";

const listMembers = vi.fn();
const listRoles = vi.fn();
const inviteMember = vi.fn();
const changeMemberRole = vi.fn();
const removeMember = vi.fn();
const resendInvite = vi.fn();
const createRole = vi.fn();
const updateRole = vi.fn();
const deleteRole = vi.fn();

vi.mock("../../lib/team-api", () => ({
  listMembers: (...args: unknown[]) => listMembers(...args),
  listRoles: (...args: unknown[]) => listRoles(...args),
  inviteMember: (...args: unknown[]) => inviteMember(...args),
  changeMemberRole: (...args: unknown[]) => changeMemberRole(...args),
  removeMember: (...args: unknown[]) => removeMember(...args),
  resendInvite: (...args: unknown[]) => resendInvite(...args),
  createRole: (...args: unknown[]) => createRole(...args),
  updateRole: (...args: unknown[]) => updateRole(...args),
  deleteRole: (...args: unknown[]) => deleteRole(...args),
}));

// Drives usePermissions, which is what gates every management action. The
// real hook reads member.permissions (live grants), not the role name so
// the fixture derives them the same way the server would, from the same
// per-role template used to cross-check the server in lib/permissions.test.ts.
let workspaceRole = "owner";
vi.mock("../../hooks/useWorkspace", async () => {
  const { ROLE_PERMISSIONS } = await import("../../lib/permissions");
  return {
    useActiveStartupId: () => "startup-1",
    useWorkspace: () => ({
      activeStartup: {
        id: "startup-1",
        member: { role: workspaceRole, permissions: [...(ROLE_PERMISSIONS[workspaceRole] ?? [])] },
      },
    }),
  };
});

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};
vi.mock("sonner", () => ({ toast }));

let authState: { user: AuthUser | null; isLoading: boolean };
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => authState }));

const { Team } = await import("../../pages/dashboard/Team/Team");

const OWNER: AuthUser = {
  id: "u-owner",
  email: "jane@acme.io",
  firstName: "Jane",
  lastName: "Doe",
  title: null,
  avatarUrl: null,
};
const VIEWER: AuthUser = {
  id: "u-viewer",
  email: "sam@acme.io",
  firstName: "Sam",
  lastName: "Patel",
  title: null,
  avatarUrl: null,
};

const ROLES = [
  {
    id: "role-owner",
    name: "owner",
    description: "Full access",
    isSystemRole: true,
    permissions: ["startup:read", "team:manage"],
    memberCount: 1,
  },
  {
    id: "role-collab",
    name: "collaborator",
    description: "Can edit",
    isSystemRole: true,
    permissions: ["startup:read", "team:create", "pipeline:read"],
    memberCount: 0,
  },
  {
    id: "role-viewer",
    name: "viewer",
    description: "Read-only",
    isSystemRole: true,
    permissions: ["startup:read", "pipeline:read"],
    memberCount: 1,
  },
];

const MEMBERS = [
  {
    id: "m-owner",
    status: "active",
    role: "owner",
    joinedAt: "2026-03-02T00:00:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: { ...OWNER },
  },
  {
    id: "m-viewer",
    status: "active",
    role: "viewer",
    joinedAt: "2026-03-05T00:00:00.000Z",
    createdAt: "2026-03-04T00:00:00.000Z",
    user: { ...VIEWER },
  },
  {
    id: "m-pending",
    status: "pending",
    role: "collaborator",
    joinedAt: null,
    createdAt: "2026-03-06T00:00:00.000Z",
    invitedEmail: "bob@acme.io",
  },
];

function apiError(status: number, code: string, message: string) {
  return new AxiosError(message, String(status), undefined, null, {
    status,
    statusText: "",
    data: { code, error: message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

function renderTeam() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Team />
    </QueryClientProvider>,
  );
}

/** The desktop table and the mobile card list both render; scope to the table. */
function memberRow(name: string) {
  return screen.getAllByRole("row").find((row) => within(row).queryByText(name))!;
}

async function openActionsFor(name: string) {
  const user = userEvent.setup();
  await user.click(within(memberRow(name)).getByRole("button", { name: `Actions for ${name}` }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  authState = { user: OWNER, isLoading: false };
  workspaceRole = "owner";
  listMembers.mockResolvedValue(MEMBERS);
  listRoles.mockResolvedValue(ROLES);
});

describe("Team", () => {
  it("lists accepted members and pending invites with their roles", async () => {
    renderTeam();

    expect(await screen.findAllByText("Jane Doe")).not.toHaveLength(0);
    expect(screen.getAllByText("Sam Patel")).not.toHaveLength(0);
    // A pending invite has no name yet, so the invited address stands in.
    expect(screen.getAllByText("bob@acme.io")).not.toHaveLength(0);
    expect(screen.getAllByText("Invitation pending")).not.toHaveLength(0);
    expect(screen.getAllByText("Owner")).not.toHaveLength(0);
  });

  it("counts active members separately from pending invites", async () => {
    renderTeam();

    await screen.findAllByText("Jane Doe");
    expect(screen.getByText("2 members · 1 pending")).toBeInTheDocument();
  });

  it("hides every management action from a non-owner", async () => {
    authState = { user: VIEWER, isLoading: false };
    workspaceRole = "viewer";
    renderTeam();

    await screen.findAllByText("Jane Doe");
    expect(screen.queryByRole("button", { name: /invite teammate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit permissions/i })).not.toBeInTheDocument();

    const user = await openActionsFor("Sam Patel");
    expect(screen.queryByText("Change role")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove from team")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
  });

  it("changes a member's role from the actions menu", async () => {
    changeMemberRole.mockResolvedValue({ id: "m-viewer", roleId: "role-collab" });
    renderTeam();

    await screen.findAllByText("Jane Doe");
    const user = await openActionsFor("Sam Patel");
    await user.click(await screen.findByRole("menuitem", { name: "Collaborator" }));

    await waitFor(() =>
      expect(changeMemberRole).toHaveBeenCalledWith("startup-1", "m-viewer", "role-collab"),
    );
    expect(toast.success).toHaveBeenCalledWith("Sam Patel is now Collaborator");
  });

  it("explains the last-owner rule instead of the raw API error", async () => {
    changeMemberRole.mockRejectedValue(apiError(409, "LAST_OWNER", "Cannot change the role"));
    renderTeam();

    await screen.findAllByText("Jane Doe");
    const user = await openActionsFor("Jane Doe");
    await user.click(await screen.findByRole("menuitem", { name: "Viewer" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This is the last active owner. Promote someone else to owner first.",
      ),
    );
  });

  it("confirms before removing a member", async () => {
    removeMember.mockResolvedValue(undefined);
    renderTeam();

    await screen.findAllByText("Jane Doe");
    const user = await openActionsFor("Sam Patel");
    await user.click(await screen.findByRole("menuitem", { name: /remove from team/i }));

    // Nothing leaves for the API until the dialog is confirmed.
    expect(await screen.findByText("Remove Sam Patel?")).toBeInTheDocument();
    expect(removeMember).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove member" }));

    await waitFor(() => expect(removeMember).toHaveBeenCalledWith("startup-1", "m-viewer"));
    expect(toast.success).toHaveBeenCalledWith("Sam Patel was removed from the team");
  });

  it("offers Resend invitation only for people who haven't accepted", async () => {
    renderTeam();
    await screen.findAllByText("Jane Doe");

    // An accepted member has nothing to resend.
    let user = await openActionsFor("Sam Patel");
    expect(screen.queryByRole("menuitem", { name: /resend invitation/i })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    user = await openActionsFor("bob@acme.io");
    expect(
      await screen.findByRole("menuitem", { name: /resend invitation/i }),
    ).toBeInTheDocument();
  });

  it("resends a pending invitation", async () => {
    resendInvite.mockResolvedValue({ message: "Invitation resent", emailQueued: true });
    renderTeam();
    await screen.findAllByText("Jane Doe");

    const user = await openActionsFor("bob@acme.io");
    await user.click(await screen.findByRole("menuitem", { name: /resend invitation/i }));

    await waitFor(() => expect(resendInvite).toHaveBeenCalledWith("startup-1", "m-pending"));
    expect(toast.success).toHaveBeenCalledWith("A new invitation was sent to bob@acme.io");
  });

  it("warns when the resent invitation could not be emailed", async () => {
    resendInvite.mockResolvedValue({ message: "…", emailQueued: false });
    renderTeam();
    await screen.findAllByText("Jane Doe");

    const user = await openActionsFor("bob@acme.io");
    await user.click(await screen.findByRole("menuitem", { name: /resend invitation/i }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("frames removing a pending invite as revoking it", async () => {
    renderTeam();

    await screen.findAllByText("Jane Doe");
    const user = await openActionsFor("bob@acme.io");
    await user.click(await screen.findByRole("menuitem", { name: /revoke invitation/i }));

    expect(await screen.findByText("Revoke this invitation?")).toBeInTheDocument();
  });

  it("sends an invitation with the chosen role", async () => {
    inviteMember.mockResolvedValue({ message: "Invitation sent", emailQueued: true });
    const user = userEvent.setup();
    renderTeam();

    await screen.findAllByText("Jane Doe");
    await user.click(screen.getByRole("button", { name: /invite teammate/i }));
    await user.type(screen.getByLabelText("Work email"), "new@acme.io");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() =>
      // Defaults to collaborator rather than the most privileged role.
      expect(inviteMember).toHaveBeenCalledWith("startup-1", {
        email: "new@acme.io",
        roleId: "role-collab",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Invitation sent to new@acme.io");
  });

  it("warns when the member was invited but the email never queued", async () => {
    inviteMember.mockResolvedValue({ message: "…", emailQueued: false });
    const user = userEvent.setup();
    renderTeam();

    await screen.findAllByText("Jane Doe");
    await user.click(screen.getByRole("button", { name: /invite teammate/i }));
    await user.type(screen.getByLabelText("Work email"), "new@acme.io");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("surfaces a permission failure when the members list is forbidden", async () => {
    listMembers.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden"));
    renderTeam();

    expect(
      await screen.findByText("You're not an active member of this workspace."),
    ).toBeInTheDocument();
  });

  it("restricts a collaborator to inviting only the viewer role", async () => {
    workspaceRole = "collaborator";
    const user = userEvent.setup();
    renderTeam();

    await screen.findAllByText("Jane Doe");
    await user.click(screen.getByRole("button", { name: /invite teammate/i }));
    await user.click(screen.getByRole("button", { name: /viewer/i }));

    // Radix nests a DropdownMenu inside the invite Dialog each layer's own
    // "hide the rest of the page" aria-hidden trick makes the open menu
    // invisible to testing-library's accessibility-tree-aware role queries,
    // even though it's genuinely open and interactive. Query the raw DOM node
    // instead, then use `within` (plain DOM text matching, unaffected by
    // aria-hidden) to check what it actually offers.
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const menuScope = within(menu as HTMLElement);
    expect(menuScope.getByText("Viewer")).toBeInTheDocument();
    expect(menuScope.queryByText("Collaborator")).not.toBeInTheDocument();
    expect(menuScope.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("lets an owner create a new role with selected permissions", async () => {
    createRole.mockResolvedValue({
      id: "role-new",
      name: "recruiter",
      description: "",
      isSystemRole: false,
      permissions: ["team:create"],
      memberCount: 0,
    });
    const user = userEvent.setup();
    renderTeam();

    await screen.findAllByText("Jane Doe");
    await user.click(screen.getByRole("button", { name: /new role/i }));
    await user.type(screen.getByLabelText("Role name"), "recruiter");
    await user.click(screen.getByLabelText("Invite"));
    await user.click(screen.getByRole("button", { name: "Create role" }));

    // "Invite" is inert without "View members" — a role holding one and not
    // the other lands on a Team page that renders empty while its reads 403.
    // Ticking the write ticks the read it depends on, and the role is saved
    // in the shape it will actually work in.
    await waitFor(() =>
      expect(createRole).toHaveBeenCalledWith("startup-1", {
        name: "recruiter",
        description: undefined,
        permissions: ["team:read", "team:create"],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("recruiter role created");
  });

  it("lets an owner edit an existing role's permissions", async () => {
    updateRole.mockResolvedValue({
      id: "role-collab",
      name: "collaborator",
      description: "Can edit",
      isSystemRole: true,
      permissions: ["startup:read", "team:create", "pipeline:read", "pipeline:create"],
      memberCount: 0,
    });
    const user = userEvent.setup();
    renderTeam();

    await screen.findAllByText("Jane Doe");
    // Collaborator is the first non-owner role card, so its Edit permissions
    // button is the first of the two rendered (collaborator, viewer).
    await user.click(screen.getAllByRole("button", { name: /edit permissions/i })[0]);
    await user.click(screen.getByLabelText("Add"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith("startup-1", "role-collab", {
        description: "Can edit",
        // team:read is added on the way out: this fixture role predates the
        // dependency rule and held team:create without it. Saving a role is
        // where that gets repaired, on the client and again on the server.
        permissions: ["startup:read", "team:read", "team:create", "pipeline:read", "pipeline:create"],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Collaborator permissions updated");
  });

  it("never offers to edit or delete the owner role", async () => {
    renderTeam();
    await screen.findAllByText("Jane Doe");

    expect(screen.getByText("Full access can't be changed.")).toBeInTheDocument();
    // Only the two non-owner roles (collaborator, viewer) get an edit button.
    expect(screen.getAllByRole("button", { name: /edit permissions/i })).toHaveLength(2);
  });
});
