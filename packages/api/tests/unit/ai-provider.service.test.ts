import {
  AiProviderError,
  FakeAiProvider,
  OpenAiProvider,
} from "../../src/services/ai-provider.service";
import type { AiConfig } from "../../src/config/ai";

const config: AiConfig = {
  enabled: true,
  chatModel: "chat-test",
  analysisModel: "analysis-test",
  embeddingModel: "embedding-test",
  embeddingDimensions: 1536,
  requestTimeoutMs: 20,
  maxOutputTokens: 123,
  maxToolRounds: 4,
  retrievalResultCount: 8,
  retrievalTokenBudget: 4500,
  minimumRetrievalScore: 0.2,
  maxRetries: 1,
  messagesPerMinute: 20,
  concurrentStreamsPerUser: 2,
  analysesPerStartupPerDay: 20,
  queuedAnalysesPerStartup: 4,
  chatRetentionDays: 0,
};

const streamOf = (...events: unknown[]) => ({
  async *[Symbol.asyncIterator]() { yield* events; },
});

describe("OpenAiProvider", () => {
  it("maps response stream events without exposing SDK shapes", async () => {
    const create = jest.fn().mockResolvedValue(streamOf(
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.completed", response: { id: "resp-1", usage: { input_tokens: 4, output_tokens: 2 } } },
    ));
    const provider = new OpenAiProvider(config, { responses: { create }, embeddings: { create: jest.fn() } });
    const events = [];
    for await (const event of provider.streamConversation({ instructions: "safe", input: [{ role: "user", content: "Hi" }] })) events.push(event);

    expect(events).toEqual([
      { type: "delta", text: "Hello" },
      { type: "completed", providerRequestId: "resp-1", usage: { inputTokens: 4, cachedInputTokens: undefined, outputTokens: 2 }, stopReason: "stop" },
    ]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store: false, stream: true, max_output_tokens: 123 }), expect.any(Object));
  });

  it("forwards promptCacheKey to the provider as prompt_cache_key, so repeated calls for the same session can hit OpenAI's prompt cache", async () => {
    const create = jest.fn().mockResolvedValue(streamOf({ type: "response.completed", response: { id: "resp-1" } }));
    const provider = new OpenAiProvider(config, { responses: { create }, embeddings: { create: jest.fn() } });
    const events = [];
    for await (const event of provider.streamConversation({ instructions: "safe", input: [], promptCacheKey: "session-123" })) events.push(event);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ prompt_cache_key: "session-123" }), expect.any(Object));
  });

  it("retries a transient failure only before streamed output", async () => {
    const transient = Object.assign(new Error("busy"), { status: 429 });
    const create = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(streamOf({ type: "response.completed", response: { id: "resp-2" } }));
    const provider = new OpenAiProvider(config, { responses: { create }, embeddings: { create: jest.fn() } });
    const events = [];
    for await (const event of provider.streamConversation({ instructions: "safe", input: [] })) events.push(event);

    expect(create).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ type: "completed", providerRequestId: "resp-2", usage: undefined, stopReason: "stop" }]);
  });

  it("does not retry after a meaningful streamed delta", async () => {
    const transient = Object.assign(new Error("busy"), { status: 503 });
    const create = jest.fn().mockResolvedValue(streamOf(
      { type: "response.output_text.delta", delta: "Partial" },
      Promise.reject(transient),
    ));
    const provider = new OpenAiProvider(config, { responses: { create }, embeddings: { create: jest.fn() } });
    const iterator = provider.streamConversation({ instructions: "safe", input: [] })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "delta", text: "Partial" } });
    await expect(iterator.next()).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed structured output", async () => {
    const provider = new OpenAiProvider(config, {
      responses: { create: jest.fn().mockResolvedValue({ output_text: "not json" }) },
      embeddings: { create: jest.fn() },
    });
    await expect(provider.generateStructuredObject({ instructions: "safe", input: "x", schemaName: "result", schema: {} }))
      .rejects.toMatchObject({ code: "AI_MALFORMED_RESPONSE" });
  });

  it("returns a timeout error when the provider honours an aborted signal", async () => {
    const create = jest.fn((_body, options) => new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const provider = new OpenAiProvider({ ...config, requestTimeoutMs: 1, maxRetries: 1 }, { responses: { create }, embeddings: { create: jest.fn() } });
    await expect(provider.generateStructuredObject({ instructions: "safe", input: "x", schemaName: "result", schema: {} }))
      .rejects.toEqual(expect.objectContaining({ code: "AI_TIMEOUT" }));
  });

  it("offers a fake provider for tests without SDK calls", async () => {
    const provider = new FakeAiProvider();
    provider.streamEvents = [{ type: "delta", text: "fixture" }];
    const events = [];
    for await (const event of provider.streamConversation({ instructions: "x", input: [] })) events.push(event);
    expect(events).toEqual([{ type: "delta", text: "fixture" }]);
    await expect(provider.embedQuery("query")).resolves.toHaveLength(1536);
  });

  it("scripts a multi-turn tool round trip via streamEventsByTurn", async () => {
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "get_focus_deals", arguments: "{}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Here you go" }, { type: "completed", stopReason: "stop" }],
    ];
    const firstTurn = [];
    for await (const event of provider.streamConversation({ instructions: "x", input: [] })) firstTurn.push(event);
    const secondTurn = [];
    for await (const event of provider.streamConversation({ instructions: "x", input: [] })) secondTurn.push(event);

    expect(firstTurn).toEqual([{ type: "tool_call", callId: "call-1", name: "get_focus_deals", arguments: "{}" }, { type: "completed", stopReason: "tool_calls" }]);
    expect(secondTurn).toEqual([{ type: "delta", text: "Here you go" }, { type: "completed", stopReason: "stop" }]);
  });

  it("maps a function_call output item into a tool_call event and marks the completion tool_calls", async () => {
    const create = jest.fn().mockResolvedValue(streamOf(
      { type: "response.output_item.done", item: { type: "function_call", call_id: "call-1", name: "get_focus_deals", arguments: "{\"roundId\":null}" } },
      { type: "response.completed", response: { id: "resp-3" } },
    ));
    const provider = new OpenAiProvider(config, { responses: { create }, embeddings: { create: jest.fn() } });
    const events = [];
    for await (const event of provider.streamConversation({ instructions: "safe", input: [], tools: [{ type: "function", name: "get_focus_deals", description: "d", parameters: {}, strict: true }] })) events.push(event);

    expect(events).toEqual([
      { type: "tool_call", callId: "call-1", name: "get_focus_deals", arguments: "{\"roundId\":null}" },
      { type: "completed", providerRequestId: "resp-3", usage: undefined, stopReason: "tool_calls" },
    ]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ tools: [expect.objectContaining({ name: "get_focus_deals" })] }), expect.any(Object));
  });
});

describe("OpenAiProvider.embedBatch", () => {
  function embeddingFixture(seed: number): number[] {
    return Array.from({ length: 1536 }, (_, i) => (i === 0 ? seed : 0));
  }

  it("embeds every text in one provider call and preserves input order", async () => {
    const create = jest.fn().mockResolvedValue({
      data: [
        { embedding: embeddingFixture(1), index: 0 },
        { embedding: embeddingFixture(2), index: 1 },
        { embedding: embeddingFixture(3), index: 2 },
      ],
    });
    const provider = new OpenAiProvider(config, { responses: { create: jest.fn() }, embeddings: { create } });

    const embeddings = await provider.embedBatch(["a", "b", "c"]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ input: ["a", "b", "c"] }), expect.any(Object));
    expect(embeddings.map((e) => e[0])).toEqual([1, 2, 3]);
  });

  it("reorders a response whose items come back out of index order", async () => {
    // Documented as same-order, but embedBatch trusts each item's own index
    // rather than array position, so a provider that ever violates that
    // ordering still lands each embedding against the text it belongs to.
    const create = jest.fn().mockResolvedValue({
      data: [
        { embedding: embeddingFixture(2), index: 1 },
        { embedding: embeddingFixture(1), index: 0 },
      ],
    });
    const provider = new OpenAiProvider(config, { responses: { create: jest.fn() }, embeddings: { create } });

    const embeddings = await provider.embedBatch(["a", "b"]);

    expect(embeddings.map((e) => e[0])).toEqual([1, 2]);
  });

  it("splits a batch larger than the provider's per-call limit into multiple calls, still in order", async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `text-${i}`);
    const create = jest.fn().mockImplementation((body: { input: string[] }) => Promise.resolve({
      data: body.input.map((_, i) => ({ embedding: embeddingFixture(i), index: i })),
    }));
    const provider = new OpenAiProvider(config, { responses: { create: jest.fn() }, embeddings: { create } });

    const embeddings = await provider.embedBatch(texts);

    expect(create).toHaveBeenCalledTimes(2);
    expect((create.mock.calls[0][0] as { input: string[] }).input).toHaveLength(100);
    expect((create.mock.calls[1][0] as { input: string[] }).input).toHaveLength(50);
    expect(embeddings).toHaveLength(150);
    // The second call's own item index (0-based within that call) must map
    // back onto the batch's overall position (100-149), not collide with
    // the first call's indices.
    expect(embeddings[100][0]).toBe(0);
    expect(embeddings[149][0]).toBe(49);
  });

  it("returns an empty array without calling the provider for an empty batch", async () => {
    const create = jest.fn();
    const provider = new OpenAiProvider(config, { responses: { create: jest.fn() }, embeddings: { create } });

    await expect(provider.embedBatch([])).resolves.toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a response whose item count does not match the request", async () => {
    const create = jest.fn().mockResolvedValue({ data: [{ embedding: embeddingFixture(1), index: 0 }] });
    const provider = new OpenAiProvider(config, { responses: { create: jest.fn() }, embeddings: { create } });

    await expect(provider.embedBatch(["a", "b"])).rejects.toMatchObject({ code: "AI_MALFORMED_RESPONSE" });
  });

  it("rejects a malformed individual embedding", async () => {
    const create = jest.fn().mockResolvedValue({ data: [{ embedding: ["not", "numbers"], index: 0 }] });
    const provider = new OpenAiProvider(config, { responses: { create: jest.fn() }, embeddings: { create } });

    await expect(provider.embedBatch(["a"])).rejects.toMatchObject({ code: "AI_MALFORMED_RESPONSE" });
  });
});

describe("AI provider errors", () => {
  it("fails closed when chat is feature-flagged off", async () => {
    const provider = new OpenAiProvider({ ...config, enabled: false }, { responses: { create: jest.fn() }, embeddings: { create: jest.fn() } });
    await expect(async () => {
      for await (const _event of provider.streamConversation({ instructions: "x", input: [] })) { /* consume */ }
    }).rejects.toBeInstanceOf(AiProviderError);
  });
});
