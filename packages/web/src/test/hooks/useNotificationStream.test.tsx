import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AuthUser } from "../../providers/AuthProvider";

let authState: { user: AuthUser | null; isLoading: boolean };
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => authState }));

const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
vi.mock("sonner", () => ({ toast }));

/** Records every EventSource the hook opens so the test can drive it. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;

  readyState = 1;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, handler]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  /** Frames the server sends that the client cannot parse. */
  emitRaw(type: string, data: string) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data } as MessageEvent);
    }
  }
}

vi.stubGlobal("EventSource", FakeEventSource);

const { useNotificationStream } = await import("../../hooks/useNotificationStream");
const { NOTIFICATIONS_KEY } = await import("../../hooks/useNotifications");
const { MY_INVITES_KEY } = await import("../../hooks/useMyInvites");

const USER: AuthUser = {
  id: "u-1",
  email: "jane@acme.io",
  firstName: "Jane",
  lastName: "Doe",
  title: null,
  avatarUrl: null,
};

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function render() {
  const result = renderHook(() => useNotificationStream(), { wrapper });
  return { ...result, source: FakeEventSource.instances.at(-1)! };
}

/** Keys passed to invalidateQueries, flattened for easy assertion. */
function invalidatedKeys() {
  return vi.mocked(client.invalidateQueries).mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.instances = [];
  authState = { user: USER, isLoading: false };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
});

describe("useNotificationStream", () => {
  it("opens one stream against the notifications endpoint", () => {
    const { source } = render();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe("/api/v1/notifications/stream");
  });

  it("does not connect when nobody is signed in", () => {
    authState = { user: null, isLoading: false };

    render();

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("refetches the feed and the pending invites when one arrives", () => {
    // The invitation shows on the dashboard as well as in the bell, so both
    // caches are stale the moment the event lands.
    const { source } = render();

    act(() =>
      source.emit("notification.created", {
        type: "notification.created",
        notification: { id: "n-1", type: "team_invite", title: "You've been invited", body: "Join as Collaborator." },
      }),
    );

    expect(invalidatedKeys()).toEqual([
      JSON.stringify(NOTIFICATIONS_KEY),
      JSON.stringify(MY_INVITES_KEY),
    ]);
  });

  it("surfaces a new notification as a toast", () => {
    const { source } = render();

    act(() =>
      source.emit("notification.created", {
        type: "notification.created",
        notification: { id: "n-1", type: "team_invite", title: "You've been invited", body: "Join as Collaborator." },
      }),
    );

    expect(toast).toHaveBeenCalledWith("You've been invited", {
      description: "Join as Collaborator.",
    });
  });

  it("still refetches when the payload cannot be parsed", () => {
    // A malformed frame is not a reason to miss the change it announced.
    const { source } = render();

    act(() => source.emitRaw("notification.created", "not json"));

    expect(invalidatedKeys()).toHaveLength(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it("refetches on a change raised by another tab", () => {
    const { source } = render();

    act(() => source.emit("notifications.changed", { type: "notifications.changed" }));

    expect(invalidatedKeys()).toHaveLength(2);
    // Marking something read elsewhere is not worth interrupting anyone over.
    expect(toast).not.toHaveBeenCalled();
  });

  it("closes the stream on unmount", () => {
    const { unmount, source } = render();

    unmount();

    expect(source.closed).toBe(true);
  });

  it("reconnects as the signed-in account changes", () => {
    // Otherwise the stream keeps delivering the previous user's events.
    const { rerender } = render();
    const first = FakeEventSource.instances[0];

    authState = { user: { ...USER, id: "u-2" }, isLoading: false };
    rerender();

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].closed).toBe(false);
  });
});
