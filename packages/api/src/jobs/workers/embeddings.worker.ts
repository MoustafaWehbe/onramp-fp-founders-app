import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { OpenAiProvider } from "../../services/ai-provider.service";
import { JOB_NAMES } from "../job-names";

export interface EmbeddingsJobItem {
  entityId: string;
  text: string;
}

export interface EmbeddingsJobData {
  entityType: string;
  items: EmbeddingsJobItem[];
}

export interface EmbeddingsJobResult {
  count: number;
  dimensions: number;
}

export const embeddingsJob = {
  name: JOB_NAMES.embeddings,
  concurrency: 5,

  /**
   * One job embeds every chunk from a single document version (see
   * document-processing.worker.ts's enqueue site), instead of the one job
   * per chunk this used to be a 40-chunk deck was 40 separate provider
   * round trips and 40 separate UPDATE statements. embedBatch folds the
   * provider calls down to a handful (still bounded per call, see its own
   * batch-size comment); the write-back below folds the DB side down to one
   * statement regardless of chunk count.
   */
  async process(job: Job<EmbeddingsJobData, EmbeddingsJobResult>): Promise<EmbeddingsJobResult> {
    const { entityType, items } = job.data;
    if (items.length === 0) return { count: 0, dimensions: 0 };
    console.info(`[embeddings] Generating ${items.length} embedding(s) for ${entityType}`);

    const embeddings = await new OpenAiProvider().embedBatch(items.map((item) => item.text));
    if (embeddings.some((embedding) => embedding.length === 0)) {
      throw new Error("OpenAI returned an empty embedding");
    }

    if (entityType === "document_chunk") {
      const rows = items.map((item, index) => Prisma.sql`(${item.entityId}::uuid, ${`[${embeddings[index].join(",")}]`}::vector)`);
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "document_chunks" AS chunk
        SET "embedding" = data.embedding
        FROM (VALUES ${Prisma.join(rows)}) AS data(id, embedding)
        WHERE chunk.id = data.id
      `);
    }

    return { count: items.length, dimensions: embeddings[0]?.length ?? 0 };
  },
};
