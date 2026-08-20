/**
 * RedisRealtimeBus: publish goes to Redis; this process only delivers to local
 * SSE tabs when the dedicated subscriber socket receives the message.
 */
import type { RealtimeEvent } from "../../src/events/realtime-bus";

const publishMock = jest.fn().mockResolvedValue(1);
const subscribeMock = jest.fn().mockResolvedValue(1);
const unsubscribeMock = jest.fn().mockResolvedValue(1);
const onMock = jest.fn();

jest.mock("../../src/db/redis", () => ({
  getRedis: () => ({ publish: publishMock }),
  createRedis: () => ({
    on: onMock,
    subscribe: subscribeMock,
    unsubscribe: unsubscribeMock,
  }),
}));

// Import after the mock so RedisRealtimeBus wires to the fakes above.
import { RedisRealtimeBus } from "../../src/events/realtime-bus";

const CHANGED: RealtimeEvent = { type: "notifications.changed" };
const ALICE = "user-alice";

describe("RedisRealtimeBus", () => {
  beforeEach(() => {
    publishMock.mockClear();
    subscribeMock.mockClear();
    unsubscribeMock.mockClear();
    onMock.mockClear();
  });

  it("publishes JSON onto the per-user redis channel", () => {
    const bus = new RedisRealtimeBus();
    bus.publish(ALICE, CHANGED);

    expect(publishMock).toHaveBeenCalledWith(
      "realtime:user:user-alice",
      JSON.stringify(CHANGED),
    );
  });

  it("subscribes to redis only when the first local tab opens", () => {
    const bus = new RedisRealtimeBus();
    const stop1 = bus.subscribe(ALICE, jest.fn());
    const stop2 = bus.subscribe(ALICE, jest.fn());

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith("realtime:user:user-alice");

    stop1();
    stop2();
  });

  it("unsubscribes from redis when the last local tab closes", () => {
    const bus = new RedisRealtimeBus();
    const stop1 = bus.subscribe(ALICE, jest.fn());
    const stop2 = bus.subscribe(ALICE, jest.fn());

    stop1();
    expect(unsubscribeMock).not.toHaveBeenCalled();

    stop2();
    expect(unsubscribeMock).toHaveBeenCalledWith("realtime:user:user-alice");
  });

  it("fans a redis message out to every local tab for that user", () => {
    const bus = new RedisRealtimeBus();
    const tabs = [jest.fn(), jest.fn()];
    const stop = tabs.map((tab) => bus.subscribe(ALICE, tab));

    const messageHandler = onMock.mock.calls.find(([event]) => event === "message")?.[1] as
      | ((channel: string, raw: string) => void)
      | undefined;
    expect(messageHandler).toBeDefined();

    messageHandler!("realtime:user:user-alice", JSON.stringify(CHANGED));

    tabs.forEach((tab) => expect(tab).toHaveBeenCalledWith(CHANGED));
    stop.forEach((fn) => fn());
  });

  it("ignores redis messages for users with no local tabs", () => {
    const bus = new RedisRealtimeBus();
    bus.subscribe(ALICE, jest.fn()); // forces subscriber socket creation

    const messageHandler = onMock.mock.calls.find(([event]) => event === "message")?.[1] as
      | ((channel: string, raw: string) => void)
      | undefined;

    expect(() =>
      messageHandler!("realtime:user:somebody-else", JSON.stringify(CHANGED)),
    ).not.toThrow();
  });
});
