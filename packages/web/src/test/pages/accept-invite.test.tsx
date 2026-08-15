import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import type { AuthUser } from "../../providers/AuthProvider";

const acceptInvite = vi.fn();
vi.mock("../../lib/invite-api", () => ({ acceptInvite: (token: string) => acceptInvite(token) }));

const setActiveStartupId = vi.fn();
vi.mock("../../lib/app-store", () => ({
  useAppStore: (selector: (state: { setActiveStartupId: typeof setActiveStartupId }) => unknown) =>
    selector({ setActiveStartupId }),
}));

let authState: { user: AuthUser | null; isLoading: boolean } = { user: null, isLoading: false };
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => authState }));

// Imported after the mocks so the component picks them up.
const { AcceptInvite } = await import("../../pages/auth/accept-invite");

const MEMBER = {
  id: "m-1",
  startupId: "s-1",
  userId: "u-1",
  roleId: "r-1",
  status: "active",
  joinedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return new AxiosError(message, String(status), undefined, null, {
    status,
    statusText: "",
    data: { code, error: message, ...extra },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

function renderWithToken(token: string | null) {
  window.history.replaceState({}, "", token === null ? "/accept-invite" : `/accept-invite?token=${token}`);
  return render(
    <MemoryRouter>
      <AcceptInvite />
    </MemoryRouter>,
  );
}

describe("AcceptInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState = { user: null, isLoading: false };
  });

  it("shows the invalid screen and never calls the API without a token", () => {
    renderWithToken(null);

    expect(screen.getByText("Invalid invitation link")).toBeInTheDocument();
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it("adopts the joined workspace and points a signed-in user at the dashboard", async () => {
    authState = {
      user: { id: "u-1", email: "a@b.co", firstName: "A", lastName: "B", avatarUrl: null },
      isLoading: false,
    };
    acceptInvite.mockResolvedValue({ status: "accepted", member: MEMBER });

    renderWithToken("tok");

    expect(await screen.findByText("You're in")).toBeInTheDocument();
    expect(setActiveStartupId).toHaveBeenCalledWith("s-1");
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("sends a signed-out visitor to sign in and back to the invitation", async () => {
    // Nothing has been accepted yet the invite is still pending server-side.
    acceptInvite.mockResolvedValue({ status: "requires_login", email: "bob@corp.io" });

    renderWithToken("tok");

    expect(await screen.findByText("Sign in to accept")).toBeInTheDocument();
    expect(setActiveStartupId).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/login?next=%2Faccept-invite%3Ftoken%3Dtok&email=bob%40corp.io",
    );
  });

  it("does not switch workspace when signed in as the wrong account", async () => {
    authState = {
      user: { id: "someone-else", email: "x@y.co", firstName: "X", lastName: "Y", avatarUrl: null },
      isLoading: false,
    };
    acceptInvite.mockRejectedValue(
      apiError(403, "EMAIL_MISMATCH", "wrong account", {
        invitedEmail: "bob@corp.io",
        signedInAs: "x@y.co",
      }),
    );

    renderWithToken("tok");

    expect(await screen.findByText("This invitation isn't for this account")).toBeInTheDocument();
    expect(screen.getByText("bob@corp.io")).toBeInTheDocument();
    expect(setActiveStartupId).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Switch account" })).toHaveAttribute(
      "href",
      "/auth/login?next=%2Faccept-invite%3Ftoken%3Dtok&email=bob%40corp.io",
    );
  });

  it("routes an unregistered invitee to register with the email prefilled", async () => {
    acceptInvite.mockResolvedValue({ status: "requires_registration", email: "new@corp.io" });

    renderWithToken("tok");

    expect(await screen.findByText("Create your account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/auth/register?email=new%40corp.io",
    );
  });

  it.each([
    ["TOKEN_EXPIRED", 410, "This invitation has expired"],
    ["ALREADY_ACCEPTED", 409, "Already accepted"],
    ["INVALID_TOKEN", 404, "Invalid invitation link"],
  ])("maps %s to its own screen", async (code, status, heading) => {
    acceptInvite.mockRejectedValue(apiError(status, code, "nope"));

    renderWithToken("tok");

    expect(await screen.findByText(heading)).toBeInTheDocument();
  });

  it("falls back to the API message for unrecognised failures", async () => {
    acceptInvite.mockRejectedValue(apiError(500, "BOOM", "Database unavailable"));

    renderWithToken("tok");

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Database unavailable")).toBeInTheDocument();
  });

  it("only spends the single-use token once even though StrictMode double-mounts", async () => {
    acceptInvite.mockResolvedValue({ status: "accepted", member: MEMBER });

    const { StrictMode } = await import("react");
    window.history.replaceState({}, "", "/accept-invite?token=tok");
    render(
      <StrictMode>
        <MemoryRouter>
          <AcceptInvite />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByText("You're in")).toBeInTheDocument();
    expect(acceptInvite).toHaveBeenCalledTimes(1);
  });
});
