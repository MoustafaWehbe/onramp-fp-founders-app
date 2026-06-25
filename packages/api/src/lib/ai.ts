import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    client = new OpenAI({ apiKey });
  }
  return client;
}

export async function chatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: Partial<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming>,
): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    ...options,
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0]?.embedding ?? [];
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await getClient().embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Vectors must have the same length");
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}
