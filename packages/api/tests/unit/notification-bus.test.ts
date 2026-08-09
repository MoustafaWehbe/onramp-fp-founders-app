import { notificationBus, type NotificationEvent } from "../../src/events/notification-bus";

const CHANGED: NotificationEvent = { type: "notifications.changed" };

const ALICE = "user-alice";
const BOB = "user-bob";

describe("notificationBus", () => {
  it("delivers only to the user the event is for", async () => {
    const toAlice = jest.fn();
    const toBob = jest.fn();
    const stop = [
      notificationBus.subscribe(ALICE, toAlice),
      notificationBus.subscribe(BOB, toBob),
    ];

    notificationBus.publish(ALICE, CHANGED);

    expect(toAlice).toHaveBeenCalledWith(CHANGED);
    expect(toBob).not.toHaveBeenCalled();
    stop.forEach((fn) => fn());
  });

  it("reaches every tab the same user has open", () => {
    const tabs = [jest.fn(), jest.fn(), jest.fn()];
    const stop = tabs.map((tab) => notificationBus.subscribe(ALICE, tab));

    notificationBus.publish(ALICE, CHANGED);

    tabs.forEach((tab) => expect(tab).toHaveBeenCalledTimes(1));
    stop.forEach((fn) => fn());
  });

  it("stops delivering once unsubscribed", () => {
    const subscriber = jest.fn();
    const unsubscribe = notificationBus.subscribe(ALICE, subscriber);

    unsubscribe();
    notificationBus.publish(ALICE, CHANGED);

    expect(subscriber).not.toHaveBeenCalled();
  });

  it("survives unsubscribing twice", () => {
    // The SSE handler releases on both "close" and its error path.
    const other = jest.fn();
    const unsubscribe = notificationBus.subscribe(ALICE, jest.fn());
    const stopOther = notificationBus.subscribe(ALICE, other);

    unsubscribe();
    unsubscribe();
    notificationBus.publish(ALICE, CHANGED);

    expect(other).toHaveBeenCalledTimes(1);
    stopOther();
  });

  it("keeps delivering when one subscriber throws", () => {
    // A single broken stream must not silence the others.
    const healthy = jest.fn();
    const broken = jest.fn(() => {
      throw new Error("socket already destroyed");
    });
    const stop = [
      notificationBus.subscribe(ALICE, broken),
      notificationBus.subscribe(ALICE, healthy),
    ];
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    notificationBus.publish(ALICE, CHANGED);

    expect(healthy).toHaveBeenCalledWith(CHANGED);
    consoleError.mockRestore();
    stop.forEach((fn) => fn());
  });

  it("tolerates a subscriber unsubscribing while being notified", () => {
    const second = jest.fn();
    let unsubscribeFirst = () => {};
    unsubscribeFirst = notificationBus.subscribe(ALICE, () => unsubscribeFirst());
    const stopSecond = notificationBus.subscribe(ALICE, second);

    expect(() => notificationBus.publish(ALICE, CHANGED)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
  });

  it("publishing to nobody is a no-op", () => {
    expect(() => notificationBus.publish("user-with-no-tabs", CHANGED)).not.toThrow();
  });

  it("releases the user's slot entirely once the last tab closes", () => {
    // Otherwise a long-running process accumulates one empty Set per user who
    // has ever connected.
    const stop = notificationBus.subscribe(ALICE, jest.fn());
    expect(notificationBus.subscriberCount(ALICE)).toBe(1);

    stop();

    expect(notificationBus.subscriberCount(ALICE)).toBe(0);
    expect(notificationBus.subscriberCount()).toBe(0);
  });
});
