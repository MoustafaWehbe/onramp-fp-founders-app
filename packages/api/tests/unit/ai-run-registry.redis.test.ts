const evalMock = jest.fn();
const publishMock = jest.fn().mockResolvedValue(1);
const psubscribeMock = jest.fn().mockResolvedValue(1);
const onMock = jest.fn();

jest.mock("../../src/db/redis", () => ({
  getRedis: () => ({
    eval: evalMock,
    publish: publishMock,
    set: jest.fn(), sadd: jest.fn(), expire: jest.fn(), del: jest.fn(), srem: jest.fn(), exists: jest.fn(), smembers: jest.fn(),
  }),
  createRedis: () => ({ on: onMock, psubscribe: psubscribeMock }),
}));

import { RedisAiRunRegistry } from "../../src/services/ai-run-registry";

describe("Redis AI run registry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [1, "claimed"],
    [0, "already_active"],
    [-1, "limit_reached"],
  ] as const)("maps the atomic claim result %s to %s", async (redisResult, expected) => {
    evalMock.mockResolvedValue(redisResult);
    const registry = new RedisAiRunRegistry();

    await expect(registry.tryClaim("message-1", "user-1", 2)).resolves.toBe(expected);

    expect(evalMock).toHaveBeenCalledWith(expect.stringContaining("active >= tonumber(ARGV[2])"), 2, "ai:run:message-1", "ai:active-streams:user-1", "message-1", 2, 20);
  });

  it("aborts a locally-owned run immediately while also publishing cancellation for other replicas", async () => {
    const registry = new RedisAiRunRegistry();
    const cancel = jest.fn();
    registry.onCancel("message-1", cancel);
    await registry.readyForCancellation();

    await registry.requestCancel("message-1");

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith("ai:cancel:message-1", "1");
  });
});
