import type { Job } from "bullmq";
import { prisma } from "../../db/prisma";
import { OpenAiProvider } from "../../services/ai-provider.service";

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

    const embedding = await new OpenAiProvider().embedQuery(text);
    if (embedding.length === 0) {
      throw new Error("OpenAI returned an empty embedding");
    }

    if (entityType === "document_chunk") {
      const vectorLiteral = `[${embedding.join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "document_chunks" SET "embedding" = $1::vector WHERE "id" = $2`,
        vectorLiteral,
        entityId,
      );
    }

    return { dimensions: embedding.length };
  },
};
