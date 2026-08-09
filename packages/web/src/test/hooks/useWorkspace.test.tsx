import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AuthUser } from "../../providers/AuthProvider";
import type { WorkspaceSummary } from "../../lib/startup-api";

const listMyStartups = vi.fn();
const activateStartup = vi.fn();
vi.mock("../../lib/startup-api", () => ({
  listMyStartups: () => listMyStartups(),
  activateStartup: (id: string) => activateStartup(id),
}));

let authState: { user: AuthUser | null; isLoading: boolean };
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => authState }));

let preferredStartupId: string | null = null;
const setActiveStartupId = vi.fn((id: string) => {
  preferredStartupId = id;
});
vi.mock("../../lib/app-store", () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ preferredStartupId, setActiveStartupId }),
}));

const { useWorkspace } = await import("../../hooks/useWorkspace");

const USER: AuthUser = {
  id: "u-1",
  email: "jane@acme.io",
  firstName: "Jane",
  lastName: "Doe",
  avatarUrl: null,
};

function workspace(id: string, name: string): WorkspaceSummary {
  return {
    id,
    name,
    description: null,
    industry: "SaaS",
    website: null,
    fundingStage: "seed",
    createdBy: "u-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    member: { id: `m-${id}`, status: "active", role: "owner", joinedAt: null },
  };
}

const ALPHA = workspace("s-alpha", "Alpha");
const BETA = workspace("s-beta", "Beta");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  authState = { user: USER, isLoading: false };
  preferredStartupId = null;
  listMyStartups.mockResolvedValue([ALPHA, BETA]);
  activateStartup.mockResolvedValue(undefined);
});

describe("useWorkspace switching", () => {
  it("stores the choice locally and persists it for other devices", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setActiveStartupId("s-beta"));

    expect(setActiveStartupId).toHaveBeenCalledWith("s-beta");
    await waitFor(() => expect(activateStartup).toHaveBeenCalledWith("s-beta"));
  });

  it("keeps the local switch even if persisting it fails", async () => {
    // Losing the cross-device preference is a far smaller problem than
    // refusing to switch workspace at all.
    activateStartup.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setActiveStartupId("s-beta"));

    expect(setActiveStartupId).toHaveBeenCalledWith("s-beta");
    await waitFor(() => expect(activateStartup).toHaveBeenCalled());
  });
});

describe("useWorkspace", () => {
  it("falls back to the first workspace when nothing else points anywhere", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeStartupId).toBe("s-alpha");
    expect(result.current.hasNoWorkspace).toBe(false);
  });

  it("prefers the server's lastActiveStartupId over list order", async () => {
    authState = { user: { ...USER, lastActiveStartupId: "s-beta" }, isLoading: false };

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeStartupId).toBe("s-beta");
  });

  it("lets an explicit local choice win over the server hint", async () => {
    preferredStartupId = "s-beta";
    authState = { user: { ...USER, lastActiveStartupId: "s-alpha" }, isLoading: false };

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeStartupId).toBe("s-beta");
  });

  it("ignores a stored id that is no longer in the list", async () => {
    // Left the workspace, or it was seeded by an older build — either way the
    // stored preference must not strand the user on a 403.
    preferredStartupId = "s-deleted";

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeStartupId).toBe("s-alpha");
  });

  it("ignores a stale lastActiveStartupId the same way", async () => {
    authState = { user: { ...USER, lastActiveStartupId: "s-gone" }, isLoading: false };

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeStartupId).toBe("s-alpha");
  });

  it("reports hasNoWorkspace for a user who belongs to nothing", async () => {
    listMyStartups.mockResolvedValue([]);

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasNoWorkspace).toBe(true);
    expect(result.current.activeStartupId).toBeNull();
  });

  it("does not claim hasNoWorkspace when the request failed", async () => {
    // Onboarding a user because of a network blip would invite a duplicate startup.
    listMyStartups.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.hasNoWorkspace).toBe(false);
  });

  it("does not query at all until there is a signed-in user", async () => {
    authState = { user: null, isLoading: false };

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listMyStartups).not.toHaveBeenCalled();
    expect(result.current.hasNoWorkspace).toBe(false);
  });
});
