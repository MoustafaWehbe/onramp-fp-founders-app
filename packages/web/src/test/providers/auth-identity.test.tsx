import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

const post = vi.fn();
const get = vi.fn();
vi.mock("../../lib/api-client", () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    get: (...args: unknown[]) => get(...args),
  },
}));

const { AuthProvider, useAuthContext } = await import("../../providers/AuthProvider");
const { useAppStore } = await import("../../lib/app-store");

const ALICE = {
  id: "u-alice",
  email: "alice@acme.io",
  firstName: "Alice",
  lastName: "A",
  avatarUrl: null,
};
const BOB = { id: "u-bob", email: "bob@acme.io", firstName: "Bob", lastName: "B", avatarUrl: null };

const SESSION_KEY = "fp:has-session";

/** Stands in for any workspace/role/list query held while signed in. */
const fetchWorkspaces = vi.fn();

function Harness() {
  const { user, login, logout } = useAuthContext();
  const { data } = useQuery({
    queryKey: ["my-startups"],
    queryFn: fetchWorkspaces,
    enabled: Boolean(user),
  });

  return (
    <div>
      <span data-testid="user">{user?.email ?? "signed out"}</span>
      <span data-testid="workspaces">{data ?? "none"}</span>
      <button onClick={() => void login("x", "y")}>sign in</button>
      <button onClick={() => void logout()}>sign out</button>
    </div>
  );
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

async function signInAs(user: typeof ALICE, workspaces: string) {
  post.mockResolvedValueOnce({ data: { data: { user } } });
  fetchWorkspaces.mockResolvedValueOnce(workspaces);
  await act(async () => {
    screen.getByText("sign in").click();
  });
  await waitFor(() => expect(screen.getByTestId("workspaces")).toHaveTextContent(workspaces));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAppStore.setState({ preferredStartupId: null });
});

describe("identity-scoped cache", () => {
  it("does not serve the previous account's data to the next one", async () => {
    // The reported bug: sign out of the owner account, sign in as the invited
    // collaborator, and the owner's workspaces (and role) were still on screen
    // until a manual refresh. react-query hands over cached data instantly and
    // only corrects itself when the refetch lands, so the window is real.
    renderApp();

    await signInAs(ALICE, "alice-workspaces");

    post.mockResolvedValueOnce({ data: {} });
    await act(async () => {
      screen.getByText("sign out").click();
    });
    expect(screen.getByTestId("user")).toHaveTextContent("signed out");

    // Bob's fetch never settles, so anything on screen can only have come from
    // the cache. It must be the empty state, not Alice's workspaces.
    post.mockResolvedValueOnce({ data: { data: { user: BOB } } });
    fetchWorkspaces.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      screen.getByText("sign in").click();
    });

    expect(screen.getByTestId("user")).toHaveTextContent("bob@acme.io");
    expect(screen.getByTestId("workspaces")).toHaveTextContent("none");
    expect(screen.queryByText("alice-workspaces")).not.toBeInTheDocument();
  });

  it("drops the cache on sign-out so nothing survives to the next session", async () => {
    const client = renderApp();
    await signInAs(ALICE, "alice-workspaces");
    expect(client.getQueryData(["my-startups"])).toBe("alice-workspaces");

    post.mockResolvedValueOnce({ data: {} });
    await act(async () => {
      screen.getByText("sign out").click();
    });

    expect(client.getQueryData(["my-startups"])).toBeUndefined();
  });

  it("forgets the workspace preference, which belonged to the previous user", async () => {
    // Otherwise the next account opens whichever workspace the last one chose —
    // and in the invite flow they are often members of that very workspace.
    renderApp();
    await signInAs(ALICE, "alice-workspaces");
    act(() => useAppStore.getState().setActiveStartupId("s-alice"));

    await signInAs(BOB, "bob-workspaces");

    expect(useAppStore.getState().preferredStartupId).toBeNull();
  });

  it("records which account the session hint belongs to", async () => {
    renderApp();
    await signInAs(ALICE, "alice-workspaces");

    expect(localStorage.getItem(SESSION_KEY)).toBe("u-alice");
  });

  it("follows a sign-in that happened in another tab", async () => {
    renderApp();
    await signInAs(ALICE, "alice-workspaces");

    // The other tab swapped the cookie; this one only sees the storage event.
    get.mockResolvedValueOnce({ data: { data: BOB } });
    fetchWorkspaces.mockResolvedValueOnce("bob-workspaces");
    await act(async () => {
      localStorage.setItem(SESSION_KEY, BOB.id);
      window.dispatchEvent(
        new StorageEvent("storage", { key: SESSION_KEY, newValue: BOB.id }),
      );
    });

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("bob@acme.io"));
    expect(screen.getByTestId("workspaces")).toHaveTextContent("bob-workspaces");
  });

  it("follows a sign-out that happened in another tab", async () => {
    renderApp();
    await signInAs(ALICE, "alice-workspaces");

    await act(async () => {
      localStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: SESSION_KEY, newValue: null }));
    });

    expect(screen.getByTestId("user")).toHaveTextContent("signed out");
    expect(get).not.toHaveBeenCalled();
  });

  it("restores a session whose cookie belongs to a different account", async () => {
    // Hint says Alice, but the cookie is Bob's reload after another tab
    // switched accounts. Nothing cached under the hint may be trusted.
    localStorage.setItem(SESSION_KEY, ALICE.id);
    useAppStore.setState({ preferredStartupId: "s-alice" });
    get.mockResolvedValueOnce({ data: { data: BOB } });
    fetchWorkspaces.mockResolvedValueOnce("bob-workspaces");

    renderApp();

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("bob@acme.io"));
    expect(localStorage.getItem(SESSION_KEY)).toBe("u-bob");
    expect(useAppStore.getState().preferredStartupId).toBeNull();
  });

  it("keeps the preference when the restored session is the same account", async () => {
    localStorage.setItem(SESSION_KEY, ALICE.id);
    useAppStore.setState({ preferredStartupId: "s-alice" });
    get.mockResolvedValueOnce({ data: { data: ALICE } });
    fetchWorkspaces.mockResolvedValueOnce("alice-workspaces");

    renderApp();

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("alice@acme.io"));
    expect(useAppStore.getState().preferredStartupId).toBe("s-alice");
  });
});
