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
export interface StreamConversationRequest { instructions: string; input: AiInputItem[]; tools?: AiToolDefinition[]; signal?: AbortSignal; }
export interface StructuredObjectRequest { instructions: string; input: string; schemaName: string; schema: Record<string, unknown>; signal?: AbortSignal; }
export interface StructuredObjectResult { providerRequestId?: string; value: unknown; usage?: AiUsage; }
export interface AiProvider {
  streamConversation(request: StreamConversationRequest): AsyncIterable<AiStreamEvent>;
  generateStructuredObject(request: StructuredObjectRequest): Promise<StructuredObjectResult>;
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
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

function usageOf(value: any): AiUsage | undefined {
  const usage = value?.usage;
  return usage ? { inputTokens: usage.input_tokens, cachedInputTokens: usage.input_tokens_details?.cached_tokens, outputTokens: usage.output_tokens } : undefined;
}

function normalizeError(error: unknown, signal?: AbortSignal): AiProviderError {
  if (signal?.aborted) return new AiProviderError(signal.reason === "timeout" ? "AI request timed out" : "AI request cancelled", signal.reason === "timeout" ? "AI_TIMEOUT" : "AI_CANCELLED");
  const status = typeof error === "object" && error !== null ? (error as { status?: number }).status : undefined;
  return new AiProviderError("AI provider request failed", "AI_PROVIDER_ERROR", status === 408 || status === 409 || status === 429 || (typeof status === "number" && status >= 500));
}
function isAsyncIterable(value: unknown): value is AsyncIterable<any> { return Boolean(value) && typeof (value as AsyncIterable<any>)[Symbol.asyncIterator] === "function"; }

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
        const stream = await this.client.responses.create({ model: this.config.chatModel, instructions: request.instructions, input, tools: request.tools?.length ? request.tools : undefined, max_output_tokens: this.config.maxOutputTokens, store: false, stream: true }, { signal: timed.signal });
        if (!isAsyncIterable(stream)) throw new AiProviderError("AI provider returned a non-stream response", "AI_MALFORMED_RESPONSE");
        for await (const event of stream) {
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") { deliveredOutput = true; yield { type: "delta", text: event.delta }; }
          else if (event.type === "response.refusal.delta" && typeof event.delta === "string") yield { type: "refusal", message: event.delta };
          else if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
            deliveredOutput = true;
            sawToolCall = true;
            yield { type: "tool_call", callId: event.item.call_id, name: event.item.name, arguments: event.item.arguments ?? "{}" };
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
    const response = await this.withRetries((signal) => this.client.responses.create({ model: this.config.analysisModel, instructions: request.instructions, input: request.input, max_output_tokens: this.config.analysisMaxOutputTokens, store: false, text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } } }, { signal }), request.signal);
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
}
