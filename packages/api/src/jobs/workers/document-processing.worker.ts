import type { Job } from "bullmq";
import { JOB_NAMES } from "../job-names";
import { prisma } from "../../db/prisma";
import { chunkMarkdown } from "../../services/document-chunking";
import { extractDocumentMarkdown } from "../../services/document-parse";
import { storageService } from "../../services/storage.service";

export interface DocumentProcessingJobData {
  startupId: string;
  documentId: string;
  versionId: string;
}

export const documentProcessingJob = {
  name: JOB_NAMES.documentProcessing,
  concurrency: 2,

  async process(job: Job<DocumentProcessingJobData>): Promise<{ chunkCount: number }> {
    const { versionId } = job.data;
    const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
    if (!version) return { chunkCount: 0 };

    try {
      await prisma.documentVersion.update({
        where: { id: versionId },
        data: { processingStatus: "processing", processingError: null },
      });

      const buffer = await storageService.readObject(version.storageKey, version.storageProvider);
      const checksum = storageService.checksum(buffer);
      const markdown = await extractDocumentMarkdown({
        buffer,
        mimeType: version.mimeType,
        originalFilename: version.originalFilename,
      });
      const chunks = chunkMarkdown(markdown);

      await prisma.$transaction(async (tx) => {
        await tx.documentChunk.deleteMany({ where: { documentVersionId: versionId } });
        if (chunks.length > 0) {
          await tx.documentChunk.createMany({
            data: chunks.map((chunk) => ({
              documentVersionId: versionId,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              tokenCount: chunk.tokenCount,
              sectionLabel: chunk.sectionLabel,
              charStart: chunk.charStart,
              charEnd: chunk.charEnd,
            })),
          });
        }
        await tx.documentVersion.update({
          where: { id: versionId },
          data: {
            checksumSha256: checksum,
            processingStatus: "ready",
            processingError: null,
          },
        });
      });

      const stored = await prisma.documentChunk.findMany({
        where: { documentVersionId: versionId },
        select: { id: true, content: true },
        orderBy: { chunkIndex: "asc" },
      });

      // One job for every chunk in this version, not one job per chunk -
      // the embeddings worker batches the provider calls and writes every
      // embedding back in a single statement (see embeddings.worker.ts).
      if (stored.length > 0) {
        const { embeddingsQueue } = await import("../queue");
        await embeddingsQueue.add("embed-chunks", {
          entityType: "document_chunk",
          items: stored.map((chunk) => ({ entityId: chunk.id, text: chunk.content })),
        });
      }

      return { chunkCount: stored.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Document processing failed";
      await prisma.documentVersion.update({
        where: { id: versionId },
        data: { processingStatus: "failed", processingError: message.slice(0, 1000) },
      });
      throw err;
    }
  },
};
