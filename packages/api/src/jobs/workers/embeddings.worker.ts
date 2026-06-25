import type { Job } from "bullmq";
import { generateEmbedding } from "../../utils/ai";

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
