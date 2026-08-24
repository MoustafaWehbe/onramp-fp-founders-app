import OpenAI from "openai";
import { getAiConfig, type AiConfig } from "../config/ai";

export interface AiUsage { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; }
export type AiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "completed"; providerRequestId?: string; usage?: AiUsage; stopReason?: "tool_calls" | "stop" }
  | { type: "refusal"; message: string };
export interface ConversationMessage { role: "user" | "assistant"; content: string; }
/** A prior tool call the model made, replayed back into context for a follow-up turn. */
export interface FunctionCallInputItem { type: "function_call"; callId: string; name: string; arguments: string; }
/** The server-computed result of a tool call, replayed back into context. */
export interface FunctionCallOutputInputItem { type: "function_call_output"; callId: string; output: string; }
export type AiInputItem = ConversationMessage | FunctionCallInputItem | FunctionCallOutputInputItem;
export interface AiToolDefinition { type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: true; }
export interface StreamConversationRequest { instructions: string; input: AiInputItem[]; tools?: AiToolDefinition[]; signal?: AbortSignal; promptCacheKey?: string; }
export interface StructuredObjectRequest { instructions: string; input: string; schemaName: string; schema: Record<string, unknown>; signal?: AbortSignal; promptCacheKey?: string; }
export interface StructuredObjectResult { providerRequestId?: string; value: unknown; usage?: AiUsage; }
export interface AiProvider {
  streamConversation(request: StreamConversationRequest): AsyncIterable<AiStreamEvent>;
  generateStructuredObject(request: StructuredObjectRequest): Promise<StructuredObjectResult>;
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
  /** Embeds many texts in as few provider round trips as possible, order-preserving. For bulk ingestion (e.g. a document's chunks); embedQuery stays the one-off path for a live search query. */
  embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

interface OpenAiClient {
  responses: { create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>; };
  embeddings: { create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>; };
}

export class AiProviderError extends Error {
  constructor(message: string, public readonly code: "AI_DISABLED" | "AI_TIMEOUT" | "AI_CANCELLED" | "AI_PROVIDER_ERROR" | "AI_MALFORMED_RESPONSE" | "AI_RESPONSE_TRUNCATED", public readonly retryable = false) {
    super(message); this.name = "AiProviderError";
  }
}

function requestSignal(inputSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abort = () => controller.abort(inputSignal?.reason ?? "cancelled");
  inputSignal?.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, cleanup: () => { clearTimeout(timeout); inputSignal?.removeEventListener("abort", abort); } };
}

type ProviderUsageContainer = {
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
  };
};

type ProviderStreamEvent = {
  type?: string;
  delta?: string;
  item?: { type?: string; call_id?: string; name?: string; arguments?: string };
  response?: ProviderUsageContainer & { id?: string };
};

function usageOf(value: unknown): AiUsage | undefined {
  const usage = typeof value === "object" && value !== null && "usage" in value
    ? (value as ProviderUsageContainer).usage
    : undefined;
  return usage ? { inputTokens: usage.input_tokens, cachedInputTokens: usage.input_tokens_details?.cached_tokens, outputTokens: usage.output_tokens } : undefined;
}

function normalizeError(error: unknown, signal?: AbortSignal): AiProviderError {
  if (signal?.aborted) return new AiProviderError(signal.reason === "timeout" ? "AI request timed out" : "AI request cancelled", signal.reason === "timeout" ? "AI_TIMEOUT" : "AI_CANCELLED");
  const status = typeof error === "object" && error !== null ? (error as { status?: number }).status : undefined;
  return new AiProviderError("AI provider request failed", "AI_PROVIDER_ERROR", status === 408 || status === 409 || status === 429 || (typeof status === "number" && status >= 500));
}
function isAsyncIterable(value: unknown): value is AsyncIterable<ProviderStreamEvent> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/**
 * OpenAI's embeddings endpoint accepts up to 2048 inputs per call; capped well
 * under that so one call's total tokens stay comfortably inside the request
 * budget too (document chunks average ~650 tokens each, per
 * document-chunking.ts's TARGET_TOKENS, so 100 of them is ~65k tokens).
 */
const EMBEDDING_BATCH_SIZE = 100;

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAiClient;
  private readonly hasInjectedClient: boolean;
  constructor(private readonly config: AiConfig = getAiConfig(), client?: OpenAiClient) {
    this.hasInjectedClient = Boolean(client);
    this.client = client ?? (process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as OpenAiClient : {} as OpenAiClient);
  }

  async *streamConversation(request: StreamConversationRequest): AsyncIterable<AiStreamEvent> {
    this.assertEnabled();
    let deliveredOutput = false;
    let sawToolCall = false;
    const input = request.input.map((item) =>
      "type" in item && item.type === "function_call"
        ? { type: "function_call" as const, call_id: item.callId, name: item.name, arguments: item.arguments }
        : "type" in item && item.type === "function_call_output"
          ? { type: "function_call_output" as const, call_id: item.callId, output: item.output }
          : item,
    );
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const timed = requestSignal(request.signal, this.config.requestTimeoutMs);
      try {
        const stream = await this.client.responses.create({ model: this.config.chatModel, instructions: request.instructions, input, tools: request.tools?.length ? request.tools : undefined, max_output_tokens: this.config.maxOutputTokens, store: false, stream: true, prompt_cache_key: request.promptCacheKey }, { signal: timed.signal });
        if (!isAsyncIterable(stream)) throw new AiProviderError("AI provider returned a non-stream response", "AI_MALFORMED_RESPONSE");
        for await (const event of stream) {
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") { deliveredOutput = true; yield { type: "delta", text: event.delta }; }
          else if (event.type === "response.refusal.delta" && typeof event.delta === "string") yield { type: "refusal", message: event.delta };
          else if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
            deliveredOutput = true;
            sawToolCall = true;
            if (event.item.call_id && event.item.name) {
              yield { type: "tool_call", callId: event.item.call_id, name: event.item.name, arguments: event.item.arguments ?? "{}" };
            }
          }
          else if (event.type === "response.completed") yield { type: "completed", providerRequestId: event.response?.id, usage: usageOf(event.response), stopReason: sawToolCall ? "tool_calls" : "stop" };
        }
        return;
      } catch (error) {
        const normalized = error instanceof AiProviderError ? error : normalizeError(error, timed.signal);
        if (!normalized.retryable || deliveredOutput || attempt === this.config.maxRetries) throw normalized;
      } finally { timed.cleanup(); }
    }
  }

  async generateStructuredObject(request: StructuredObjectRequest): Promise<StructuredObjectResult> {
    this.assertEnabled();
    const response = await this.withRetries((signal) => this.client.responses.create({ model: this.config.analysisModel, instructions: request.instructions, input: request.input, max_output_tokens: this.config.analysisMaxOutputTokens, store: false, prompt_cache_key: request.promptCacheKey, text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } } }, { signal }), request.signal);
    // A response cut off by the token budget is a distinct, actionable failure
    // (JSON.parse would otherwise reject it with an opaque "invalid JSON" that
    // looks identical to a genuine model malfunction) — surface it as its own
    // retryable error so truncation is diagnosable without re-deriving it from
    // provider internals every time.
    const status = (response as { status?: string }).status;
    if (status === "incomplete") {
      const reason = (response as { incomplete_details?: { reason?: string } }).incomplete_details?.reason;
      throw new AiProviderError(`AI response was truncated (${reason ?? "incomplete"})`, "AI_RESPONSE_TRUNCATED", true);
    }
    const outputText = (response as { output_text?: unknown }).output_text;
    if (typeof outputText !== "string") throw new AiProviderError("AI provider returned no structured output", "AI_MALFORMED_RESPONSE");
    try { return { providerRequestId: (response as { id?: string }).id, value: JSON.parse(outputText), usage: usageOf(response) }; }
    catch { throw new AiProviderError("AI provider returned invalid JSON", "AI_MALFORMED_RESPONSE"); }
  }

  async embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
    this.assertEmbeddingAvailable();
    const response = await this.withRetries((requestAbort) => this.client.embeddings.create({ model: this.config.embeddingModel, input: text.slice(0, 20_000), dimensions: this.config.embeddingDimensions }, { signal: requestAbort }), signal);
    const embedding = (response as { data?: Array<{ embedding?: unknown }> }).data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== this.config.embeddingDimensions || !embedding.every(Number.isFinite)) throw new AiProviderError("AI provider returned an invalid embedding", "AI_MALFORMED_RESPONSE");
    return embedding;
  }

  async embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    this.assertEmbeddingAvailable();
    if (texts.length === 0) return [];
    const results: number[][] = new Array(texts.length);
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
      const slice = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
      const response = await this.withRetries((requestAbort) => this.client.embeddings.create({ model: this.config.embeddingModel, input: slice.map((text) => text.slice(0, 20_000)), dimensions: this.config.embeddingDimensions }, { signal: requestAbort }), signal);
      const data = (response as { data?: Array<{ embedding?: unknown; index?: number }> }).data;
      if (!Array.isArray(data) || data.length !== slice.length) throw new AiProviderError("AI provider returned a mismatched embedding batch", "AI_MALFORMED_RESPONSE");
      // The API documents same-order response data, but each item also carries
      // its own index defending on that explicitly is one line and rules out
      // a subtle silent mis-assignment if that guarantee is ever loosened.
      for (const item of [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
        const offset = start + (item.index ?? 0);
        const embedding = item.embedding;
        if (!Array.isArray(embedding) || embedding.length !== this.config.embeddingDimensions || !embedding.every(Number.isFinite)) throw new AiProviderError("AI provider returned an invalid embedding", "AI_MALFORMED_RESPONSE");
        results[offset] = embedding;
      }
    }
    return results;
  }

  private assertEnabled() { if (!this.config.enabled) throw new AiProviderError("AI is disabled", "AI_DISABLED"); }
  private assertEmbeddingAvailable() {
    if (!this.hasInjectedClient && !process.env.OPENAI_API_KEY?.trim()) {
      throw new AiProviderError("OPENAI_API_KEY is not configured", "AI_DISABLED");
    }
  }
  private async withRetries<T>(operation: (signal: AbortSignal) => Promise<T>, inputSignal?: AbortSignal): Promise<T> {
    this.assertEnabled();
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const timed = requestSignal(inputSignal, this.config.requestTimeoutMs);
      try { return await operation(timed.signal); }
      catch (error) {
        const normalized = error instanceof AiProviderError ? error : normalizeError(error, timed.signal);
        if (!normalized.retryable || attempt === this.config.maxRetries) throw normalized;
      } finally { timed.cleanup(); }
    }
    throw new AiProviderError("AI provider request failed", "AI_PROVIDER_ERROR");
  }
}

/** Test-only provider: no request leaves the process. */
export class FakeAiProvider implements AiProvider {
  public readonly requests: Array<{ operation: string; input: unknown }> = [];
  public streamEvents: AiStreamEvent[] = [];
  /** Scripts a multi-turn tool round trip: each array is the events for one streamConversation call, in order. Takes precedence over `streamEvents` when non-empty. */
  public streamEventsByTurn: AiStreamEvent[][] = [];
  private streamTurn = 0;
  public structuredValue: unknown = {};
  public embedding: number[] = Array.from({ length: 1536 }, () => 0);
  /** When set, returned verbatim by embedBatch; otherwise every text gets `embedding`. */
  public embeddingBatch: number[][] | null = null;
  public error?: Error;
  async *streamConversation(request: StreamConversationRequest): AsyncIterable<AiStreamEvent> {
    this.requests.push({ operation: "streamConversation", input: request });
    if (this.error) throw this.error;
    if (this.streamEventsByTurn.length) {
      const events = this.streamEventsByTurn[Math.min(this.streamTurn, this.streamEventsByTurn.length - 1)];
      this.streamTurn += 1;
      yield* events;
      return;
    }
    yield* this.streamEvents;
  }
  async generateStructuredObject(request: StructuredObjectRequest): Promise<StructuredObjectResult> { this.requests.push({ operation: "generateStructuredObject", input: request }); if (this.error) throw this.error; return { value: this.structuredValue, providerRequestId: "fake-request" }; }
  async embedQuery(text: string): Promise<number[]> { this.requests.push({ operation: "embedQuery", input: text }); if (this.error) throw this.error; return this.embedding; }
  async embedBatch(texts: string[]): Promise<number[][]> { this.requests.push({ operation: "embedBatch", input: texts }); if (this.error) throw this.error; return this.embeddingBatch ?? texts.map(() => this.embedding); }
}
