function optionalPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function optionalRatio(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be a number between 0 and 1`);
  return value;
}

function optionalNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

export interface AiConfig {
  enabled: boolean;
  chatModel: string;
  analysisModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  requestTimeoutMs: number;
  maxOutputTokens: number;
  analysisMaxOutputTokens: number;
  maxToolRounds: number;
  retrievalResultCount: number;
  retrievalTokenBudget: number;
  minimumRetrievalScore: number;
  maxRetries: number;
  messagesPerMinute: number;
  concurrentStreamsPerUser: number;
  analysesPerStartupPerDay: number;
  queuedAnalysesPerStartup: number;
  chatRetentionDays: number;
}

/** Reads configuration at call time so test suites can safely override it. */
export function getAiConfig(): AiConfig {
  const enabled = process.env.AI_ENABLED === "true";
  const config: AiConfig = {
    enabled,
    chatModel: process.env.AI_CHAT_MODEL?.trim() || "gpt-4.1-mini",
    analysisModel: process.env.AI_ANALYSIS_MODEL?.trim() || "gpt-4.1",
    embeddingModel: process.env.AI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    embeddingDimensions: optionalPositiveInt("AI_EMBEDDING_DIMENSIONS", 1536),
    requestTimeoutMs: optionalPositiveInt("AI_REQUEST_TIMEOUT_MS", 30_000),
    maxOutputTokens: optionalPositiveInt("AI_MAX_OUTPUT_TOKENS", 2_000),
    // A pitch-deck analysis can legitimately need up to 12 gaps + 8 strengths + 4
    // personas of real text, which chat's token budget above is far too small for
    // (observed truncating mid-JSON at 2,000 tokens on an 18-chunk deck).
    analysisMaxOutputTokens: optionalPositiveInt("AI_ANALYSIS_MAX_OUTPUT_TOKENS", 8_000),
    // A propose_* call can need up to 4 rounds on its own (resolve an id,
    // propose, and — if that fails on a stale or ambiguous id — resolve and
    // propose again), which left nothing for the round that answers the user
    // at the old default of 4. Doubled so that retry path fits alongside the
    // ordinary read-then-answer chain most turns actually use.
    maxToolRounds: optionalPositiveInt("AI_MAX_TOOL_ROUNDS", 8),
    retrievalResultCount: optionalPositiveInt("AI_RETRIEVAL_RESULT_COUNT", 8),
    retrievalTokenBudget: optionalPositiveInt("AI_RETRIEVAL_TOKEN_BUDGET", 4_500),
    minimumRetrievalScore: optionalRatio("AI_MIN_RETRIEVAL_SCORE", 0.2),
    maxRetries: optionalPositiveInt("AI_MAX_RETRIES", 1),
    messagesPerMinute: optionalPositiveInt("AI_MESSAGES_PER_MINUTE", 20),
    concurrentStreamsPerUser: optionalPositiveInt("AI_CONCURRENT_STREAMS_PER_USER", 2),
    analysesPerStartupPerDay: optionalPositiveInt("AI_ANALYSES_PER_STARTUP_PER_DAY", 20),
    queuedAnalysesPerStartup: optionalPositiveInt("AI_QUEUED_ANALYSES_PER_STARTUP", 4),
    // Zero deliberately means "not configured". Retention must be an explicit
    // deployment policy decision, never an accidental default deletion rule.
    chatRetentionDays: optionalNonNegativeInt("AI_CHAT_RETENTION_DAYS", 0),
  };
  if (config.embeddingDimensions !== 1536) throw new Error("AI_EMBEDDING_DIMENSIONS must remain 1536 while document_chunks uses vector(1536)");
  if (enabled && !process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is required when AI_ENABLED is true");
  return config;
}
