import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";

const listMyInvites = vi.fn();
const acceptMyInvite = vi.fn();
const declineMyInvite = vi.fn();
vi.mock("../../hooks/useMyInvites", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    MY_INVITES_KEY: ["my-invites"],
    useMyInvites: () => useQuery({ queryKey: ["my-invites"], queryFn: () => listMyInvites() }),
  };
});

vi.mock("../../lib/invite-api", () => ({
  acceptMyInvite: (id: string) => acceptMyInvite(id),
  declineMyInvite: (id: string) => declineMyInvite(id),
}));

const setActiveStartupId = vi.fn();
vi.mock("../../hooks/useWorkspace", () => ({
  MY_STARTUPS_KEY: ["my-startups"],
  useWorkspace: () => ({ startups: [], setActiveStartupId }),
}));

// The create-startup dialog has its own coverage; here it only needs to open.
vi.mock("../../components/startup/CreateStartupDialog", () => ({
  CreateStartupDialog: ({ open }: { open: boolean }) =>
    open ? <div>Create startup dialog</div> : null,
}));

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { NoWorkspaceHome } = await import("../../pages/dashboard/NoWorkspaceHome");

const INVITE = {
  id: "m-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  inviteExpiresAt: "2026-08-08T00:00:00.000Z",
  startup: { id: "s-1", name: "Acme Inc.", industry: "SaaS", fundingStage: "seed" },
  role: { id: "r-1", name: "collaborator" },
  inviter: { firstName: "Jane", lastName: "Doe", email: "jane@acme.io" },
};

function apiError(status: number, code: string, message: string) {
  return new AxiosError(message, String(status), undefined, null, {
    status,
    statusText: "",
    data: { code, error: message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NoWorkspaceHome />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  listMyInvites.mockResolvedValue([INVITE]);
  acceptMyInvite.mockResolvedValue({ id: "m-1", startupId: "s-1" });
  declineMyInvite.mockResolvedValue(undefined);
});

describe("NoWorkspaceHome", () => {
  it("lists an invitation with its role and who sent it", async () => {
    renderHome();

    expect(await screen.findByText("Acme Inc.")).toBeInTheDocument();
    expect(screen.getByText(/Collaborator · invited by Jane Doe/)).toBeInTheDocument();
  });

  it("accepts an invitation without the emailed link", async () => {
    // The whole point: someone already signed in should never have to go
    // hunting through their inbox.
    const user = userEvent.setup();
    renderHome();
    await screen.findByText("Acme Inc.");

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(acceptMyInvite).toHaveBeenCalledWith("m-1"));
    expect(setActiveStartupId).toHaveBeenCalledWith("s-1");
    expect(toast.success).toHaveBeenCalledWith("You've joined Acme Inc.");
  });

  it("declines without joining", async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByText("Acme Inc.");

    await user.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() => expect(declineMyInvite).toHaveBeenCalledWith("m-1"));
    expect(setActiveStartupId).not.toHaveBeenCalled();
  });

  it("explains a failure rather than silently doing nothing", async () => {
    acceptMyInvite.mockRejectedValue(apiError(410, "TOKEN_EXPIRED", "This invitation has expired"));
    const user = userEvent.setup();
    renderHome();
    await screen.findByText("Acme Inc.");

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This invitation has expired"),
    );
    expect(setActiveStartupId).not.toHaveBeenCalled();
  });

  it("tells someone with no invitations that they can wait", async () => {
    listMyInvites.mockResolvedValue([]);
    renderHome();

    expect(await screen.findByText("No invitations waiting")).toBeInTheDocument();
  });

  it("offers startup creation as a dialog, not a separate page", async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByText("Acme Inc.");

    expect(screen.queryByText("Create startup dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create a startup" }));

    expect(screen.getByText("Create startup dialog")).toBeInTheDocument();
  });
});
