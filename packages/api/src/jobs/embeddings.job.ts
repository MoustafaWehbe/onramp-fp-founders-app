import type { Job } from "bullmq";
import type { EmbeddingsJobData, EmbeddingsJobResult } from "../types";
import { generateEmbedding } from "../lib/ai";

export async function processEmbeddingsJob(
  job: Job<EmbeddingsJobData, EmbeddingsJobResult>,
): Promise<EmbeddingsJobResult> {
  const { entityId, entityType, text } = job.data;
  console.info(`[embeddings] Generating embedding for ${entityType}:${entityId}`);

  const embedding = await generateEmbedding(text);

  // TODO: store the embedding vector in your database (e.g. pgvector)

  return { dimensions: embedding.length };
}
