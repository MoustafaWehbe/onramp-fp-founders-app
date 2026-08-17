import { beforeEach, describe, expect, it, vi } from "vitest";

// api-client.ts calls `axios.create(...)` to build the instance and the bare
// `axios.post(...)` for the refresh call itself both need to be mocked.
const axiosPost = vi.fn();
const instanceCall = vi.fn();
let onRejected: (error: unknown) => Promise<unknown>;

vi.mock("axios", () => {
  const create = vi.fn(() => {
    const instance = Object.assign(instanceCall, {
      interceptors: {
        response: {
          use: vi.fn((_onFulfilled: unknown, rejected: (error: unknown) => Promise<unknown>) => {
            onRejected = rejected;
          }),
        },
      },
    });
    return instance;
  });
  return { default: { create, post: axiosPost } };
});

function unauthorized(config: Record<string, unknown>) {
  return { response: { status: 401 }, config };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("api-client refresh handling", () => {
  it("shares one refresh call across 401s that arrive concurrently", async () => {
    await import("../../lib/api-client");

    axiosPost.mockReturnValue(new Promise(() => {})); // never resolves during this assertion
    instanceCall.mockResolvedValue({ data: "retried" });

    const reqA = { _retry: undefined };
    const reqB = { _retry: undefined };

    // Two requests fail with 401 at (nearly) the same time, before either
    // refresh call has settled.
    void onRejected(unauthorized(reqA));
    void onRejected(unauthorized(reqB));

    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosPost).toHaveBeenCalledWith(
      "/api/v1/auth/refresh",
      null,
      expect.objectContaining({ withCredentials: true }),
    );
  });

  it("retries every waiting request once the shared refresh resolves", async () => {
    await import("../../lib/api-client");

    let resolveRefresh: (v: unknown) => void;
    axiosPost.mockReturnValue(new Promise((resolve) => (resolveRefresh = resolve)));
    instanceCall.mockResolvedValue({ data: "retried" });

    const reqA = { _retry: undefined };
    const reqB = { _retry: undefined };
    const resultA = onRejected(unauthorized(reqA));
    const resultB = onRejected(unauthorized(reqB));

    resolveRefresh!({});
    await Promise.all([resultA, resultB]);

    expect(instanceCall).toHaveBeenCalledTimes(2);
    expect(instanceCall).toHaveBeenCalledWith(reqA);
    expect(instanceCall).toHaveBeenCalledWith(reqB);
  });

  it("issues a fresh refresh call for the next 401 after the previous one settled", async () => {
    await import("../../lib/api-client");

    axiosPost.mockResolvedValueOnce({});
    instanceCall.mockResolvedValue({ data: "retried" });

    await onRejected(unauthorized({ _retry: undefined }));
    expect(axiosPost).toHaveBeenCalledTimes(1);

    axiosPost.mockResolvedValueOnce({});
    await onRejected(unauthorized({ _retry: undefined }));
    expect(axiosPost).toHaveBeenCalledTimes(2);
  });

  it("rejects the original error when refresh fails, without retrying", async () => {
    await import("../../lib/api-client");

    const refreshError = new Error("refresh failed");
    axiosPost.mockRejectedValueOnce(refreshError);

    const original = unauthorized({ _retry: undefined });
    await expect(onRejected(original)).rejects.toBe(original);
    expect(instanceCall).not.toHaveBeenCalled();
  });

  it("does not attempt refresh twice for the same request", async () => {
    await import("../../lib/api-client");

    const alreadyRetried = { response: { status: 401 }, config: { _retry: true } };
    await expect(onRejected(alreadyRetried)).rejects.toBe(alreadyRetried);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it("serializes the refresh call through navigator.locks when available, so a second tab waits its turn", async () => {
    const locksRequest = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
    // @ts-expect-error jsdom doesn't implement the Web Locks API
    globalThis.navigator.locks = { request: locksRequest };

    await import("../../lib/api-client");

    axiosPost.mockResolvedValueOnce({});
    instanceCall.mockResolvedValue({ data: "retried" });

    await onRejected(unauthorized({ _retry: undefined }));

    expect(locksRequest).toHaveBeenCalledWith("fp:auth-refresh", expect.any(Function));
    expect(axiosPost).toHaveBeenCalledTimes(1);

    // @ts-expect-error cleanup so other tests see the same jsdom-default navigator
    delete globalThis.navigator.locks;
  });
});
