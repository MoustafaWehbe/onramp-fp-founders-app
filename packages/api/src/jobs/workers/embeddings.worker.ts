import type { Job } from "bullmq";
import OpenAI from "openai";

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0]?.embedding ?? [];
}

export interface EmbeddingsJobData {
  entityId: string;
  entityType: string;
  text: string;
}

export interface EmbeddingsJobResult {
  dimensions: number;
}

export const embeddingsJob = {
  name: "embeddings" as const,
  concurrency: 5,

  async process(job: Job<EmbeddingsJobData, EmbeddingsJobResult>): Promise<EmbeddingsJobResult> {
    const { entityId, entityType, text } = job.data;
    console.info(`[embeddings] Generating embedding for ${entityType}:${entityId}`);

    const embedding = await generateEmbedding(text);

    // TODO: store the embedding vector in your database (e.g. pgvector)

    return { dimensions: embedding.length };
  },
};
