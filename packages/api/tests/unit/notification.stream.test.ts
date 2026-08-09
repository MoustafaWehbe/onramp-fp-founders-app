import { EventEmitter } from "events";
import { notificationController } from "../../src/controllers/notification.controller";
import { notificationBus } from "../../src/events/notification-bus";

jest.mock("../../src/services/notification.service", () => ({
  notificationService: {},
  NOTIFICATION_TYPES: { TEAM_INVITE: "team_invite" },
}));

const USER_ID = "user-1";

/** Minimal stand-ins for the bits of req/res the SSE handler touches. */
function makeReqRes() {
  const req = Object.assign(new EventEmitter(), { user: { userId: USER_ID } });
  const written: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(h: Record<string, string>) {
      Object.assign(this.headers, h);
      return this;
    },
    flushHeaders: jest.fn(),
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
  });

  return { req, res, written };
}

function open() {
  const ctx = makeReqRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notificationController.stream(ctx.req as any, ctx.res as any);
  return ctx;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("GET /notifications/stream", () => {
  it("opens with the headers an event stream needs", () => {
    const { req, res } = open();

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["Cache-Control"]).toBe("no-store");
    // Without this nginx buffers the response and no event ever arrives.
    expect(res.headers["X-Accel-Buffering"]).toBe("no");
    expect(res.flushHeaders).toHaveBeenCalled();

    req.emit("close");
  });

  it("announces the retry interval and proves the pipe is open", () => {
    const { req, written } = open();

    expect(written[0]).toMatch(/^retry: \d+\n\n$/);
    expect(written[1]).toBe("event: ready\ndata: {}\n\n");

    req.emit("close");
  });

  it("writes a published event in SSE frame format", () => {
    const { req, written } = open();
    written.length = 0;

    notificationBus.publish(USER_ID, {
      type: "notification.created",
      notification: { id: "n-1", type: "team_invite", title: "You've been invited", body: null },
    });

    expect(written).toHaveLength(1);
    const [eventLine, dataLine] = written[0].split("\n");
    expect(eventLine).toBe("event: notification.created");
    expect(JSON.parse(dataLine.replace("data: ", ""))).toMatchObject({
      type: "notification.created",
      notification: { id: "n-1", title: "You've been invited" },
    });

    req.emit("close");
  });

  it("ignores events published for a different user", () => {
    const { req, written } = open();
    written.length = 0;

    notificationBus.publish("somebody-else", { type: "notifications.changed" });

    expect(written).toHaveLength(0);
    req.emit("close");
  });

  it("heartbeats so idle proxies do not hang up", () => {
    const { req, written } = open();
    written.length = 0;

    jest.advanceTimersByTime(25_000);

    // A comment frame: invisible to EventSource, but traffic on the wire.
    expect(written).toEqual([": ping\n\n"]);
    req.emit("close");
  });

  it("unsubscribes and stops heartbeating when the client disconnects", () => {
    const { req, written } = open();

    expect(notificationBus.subscriberCount(USER_ID)).toBe(1);
    req.emit("close");
    expect(notificationBus.subscriberCount(USER_ID)).toBe(0);

    written.length = 0;
    jest.advanceTimersByTime(60_000);
    notificationBus.publish(USER_ID, { type: "notifications.changed" });

    // Nothing is written to a socket that is already gone.
    expect(written).toHaveLength(0);
  });

  it("cleans up on a socket error too", () => {
    const { res } = open();

    expect(notificationBus.subscriberCount(USER_ID)).toBe(1);
    res.emit("error", new Error("ECONNRESET"));

    expect(notificationBus.subscriberCount(USER_ID)).toBe(0);
  });

  it("gives each tab its own stream", () => {
    const first = open();
    const second = open();
    first.written.length = 0;
    second.written.length = 0;

    notificationBus.publish(USER_ID, { type: "notifications.changed" });

    expect(first.written).toHaveLength(1);
    expect(second.written).toHaveLength(1);

    first.req.emit("close");
    second.req.emit("close");
    expect(notificationBus.subscriberCount(USER_ID)).toBe(0);
  });
});
