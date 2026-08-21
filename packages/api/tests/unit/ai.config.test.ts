import { getAiConfig } from "../../src/config/ai";

const keys = [
  "AI_ENABLED", "OPENAI_API_KEY", "AI_EMBEDDING_DIMENSIONS", "AI_MIN_RETRIEVAL_SCORE", "AI_REQUEST_TIMEOUT_MS",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("AI configuration", () => {
  it("is disabled by default and preserves the existing embedding dimension", () => {
    delete process.env.AI_ENABLED;
    delete process.env.OPENAI_API_KEY;
    expect(getAiConfig()).toMatchObject({ enabled: false, embeddingDimensions: 1536 });
  });

  it("requires an API key when the AI feature is enabled", () => {
    process.env.AI_ENABLED = "true";
    delete process.env.OPENAI_API_KEY;
    expect(getAiConfig).toThrow("OPENAI_API_KEY is required");
  });

  it("rejects a dimension incompatible with the persisted vector column", () => {
    process.env.AI_EMBEDDING_DIMENSIONS = "3072";
    expect(getAiConfig).toThrow("must remain 1536");
  });

  it("rejects invalid bounded values", () => {
    process.env.AI_MIN_RETRIEVAL_SCORE = "1.5";
    expect(getAiConfig).toThrow("between 0 and 1");
    process.env.AI_MIN_RETRIEVAL_SCORE = "0.2";
    process.env.AI_REQUEST_TIMEOUT_MS = "0";
    expect(getAiConfig).toThrow("positive integer");
  });
});
