const subscribers: Array<{ handlers: Map<string, (...args: any[]) => void> }> = [];

const redis = {
  lrange: jest.fn().mockResolvedValue([]),
  multi: jest.fn(() => {
    let published: [string, string] | null = null;
    const chain = {
      rpush: jest.fn(() => chain),
      ltrim: jest.fn(() => chain),
      expire: jest.fn(() => chain),
      publish: jest.fn((channel: string, payload: string) => { published = [channel, payload]; return chain; }),
      exec: jest.fn(async () => {
        if (published) {
          for (const subscriber of subscribers) subscriber.handlers.get("pmessage")?.("ai:stream-live:*", published[0], published[1]);
        }
        return [];
      }),
    };
    return chain;
  }),
};

jest.mock("../../src/db/redis", () => ({
  getRedis: () => redis,
  createRedis: () => {
    const state = { handlers: new Map<string, (...args: any[]) => void>() };
    subscribers.push(state);
    return {
      on: jest.fn((event: string, handler: (...args: any[]) => void) => { state.handlers.set(event, handler); }),
      psubscribe: jest.fn().mockResolvedValue(1),
    };
  },
}));

import { AiStreamBroker } from "../../src/services/ai-stream-broker.service";

describe("AI stream broker Redis fan-out", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    subscribers.length = 0;
    redis.multi.mockClear();
    process.env.NODE_ENV = "production";
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("delivers a live event to a subscriber on another API replica", async () => {
    const publisher = new AiStreamBroker();
    const receiver = new AiStreamBroker();
    const received = jest.fn();
    receiver.subscribe("message-1", received);
    await receiver.readyForRemoteEvents();

    const event = publisher.publish("session-1", "message-1", "message.delta", { content: "Hello" });
    await Promise.resolve();

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ sequence: event.sequence, payload: { content: "Hello" } }));
  });

  it("does not redeliver a publisher's own Redis echo", async () => {
    const broker = new AiStreamBroker();
    const received = jest.fn();
    broker.subscribe("message-1", received);
    await broker.readyForRemoteEvents();

    broker.publish("session-1", "message-1", "message.delta", { content: "Hello" });
    await Promise.resolve();

    expect(received).toHaveBeenCalledTimes(1);
  });
});
