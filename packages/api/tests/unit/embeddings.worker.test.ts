const mockEmbedBatch = jest.fn();

jest.mock("../../src/services/ai-provider.service", () => ({
  OpenAiProvider: jest.fn().mockImplementation(() => ({ embedBatch: mockEmbedBatch })),
}));

jest.mock("../../src/db/prisma", () => ({
  prisma: { $executeRaw: jest.fn() },
}));

import type { Job } from "bullmq";
import { prisma } from "../../src/db/prisma";
import { embeddingsJob, type EmbeddingsJobData, type EmbeddingsJobResult } from "../../src/jobs/workers/embeddings.worker";

const mockExecuteRaw = prisma.$executeRaw as unknown as jest.Mock;

function jobOf(data: EmbeddingsJobData): Job<EmbeddingsJobData, EmbeddingsJobResult> {
  return { data } as Job<EmbeddingsJobData, EmbeddingsJobResult>;
}

describe("embeddingsJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("embeds every item in one embedBatch call, in the same order, and writes all embeddings back in a single statement", async () => {
    mockEmbedBatch.mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    mockExecuteRaw.mockResolvedValue(0);

    const result = await embeddingsJob.process(jobOf({
      entityType: "document_chunk",
      items: [
        { entityId: "chunk-1", text: "first chunk" },
        { entityId: "chunk-2", text: "second chunk" },
      ],
    }));

    expect(mockEmbedBatch).toHaveBeenCalledTimes(1);
    expect(mockEmbedBatch).toHaveBeenCalledWith(["first chunk", "second chunk"]);
    // One write-back regardless of item count — this is the DB-side half of
    // the batching (embedBatch already folds the provider calls).
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ count: 2, dimensions: 2 });
  });

  it("does nothing for an empty item list", async () => {
    const result = await embeddingsJob.process(jobOf({ entityType: "document_chunk", items: [] }));

    expect(mockEmbedBatch).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(result).toEqual({ count: 0, dimensions: 0 });
  });

  it("skips the write-back for an entity type this worker does not persist", async () => {
    mockEmbedBatch.mockResolvedValue([[0.1]]);

    await embeddingsJob.process(jobOf({ entityType: "some_other_entity", items: [{ entityId: "x", text: "t" }] }));

    expect(mockEmbedBatch).toHaveBeenCalledWith(["t"]);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it("throws without writing anything back when any returned embedding is empty", async () => {
    mockEmbedBatch.mockResolvedValue([[0.1, 0.2], []]);

    await expect(embeddingsJob.process(jobOf({
      entityType: "document_chunk",
      items: [
        { entityId: "chunk-1", text: "a" },
        { entityId: "chunk-2", text: "b" },
      ],
    }))).rejects.toThrow("OpenAI returned an empty embedding");

    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});
