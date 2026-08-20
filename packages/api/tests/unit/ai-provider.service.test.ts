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
    for await (const event of provider.streamConversation({ instructions: "safe", messages: [{ role: "user", content: "Hi" }] })) events.push(event);

    expect(events).toEqual([
      { type: "delta", text: "Hello" },
      { type: "completed", providerRequestId: "resp-1", usage: { inputTokens: 4, cachedInputTokens: undefined, outputTokens: 2 } },
    ]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store: false, stream: true, max_output_tokens: 123 }), expect.any(Object));
  });

  it("retries a transient failure only before streamed output", async () => {
    const transient = Object.assign(new Error("busy"), { status: 429 });
    const create = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(streamOf({ type: "response.completed", response: { id: "resp-2" } }));
    const provider = new OpenAiProvider(config, { responses: { create }, embeddings: { create: jest.fn() } });
    const events = [];
    for await (const event of provider.streamConversation({ instructions: "safe", messages: [] })) events.push(event);

    expect(create).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ type: "completed", providerRequestId: "resp-2", usage: undefined }]);
  });

  it("does not retry after a meaningful streamed delta", async () => {
    const transient = Object.assign(new Error("busy"), { status: 503 });
    const create = jest.fn().mockResolvedValue(streamOf(
      { type: "response.output_text.delta", delta: "Partial" },
      Promise.reject(transient),
    ));
    const provider = new OpenAiProvider(config, { responses: { create }, embeddings: { create: jest.fn() } });
    const iterator = provider.streamConversation({ instructions: "safe", messages: [] })[Symbol.asyncIterator]();

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
    for await (const event of provider.streamConversation({ instructions: "x", messages: [] })) events.push(event);
    expect(events).toEqual([{ type: "delta", text: "fixture" }]);
    await expect(provider.embedQuery("query")).resolves.toHaveLength(1536);
  });
});

describe("AI provider errors", () => {
  it("fails closed when chat is feature-flagged off", async () => {
    const provider = new OpenAiProvider({ ...config, enabled: false }, { responses: { create: jest.fn() }, embeddings: { create: jest.fn() } });
    await expect(async () => {
      for await (const _event of provider.streamConversation({ instructions: "x", messages: [] })) { /* consume */ }
    }).rejects.toBeInstanceOf(AiProviderError);
  });
});
