import { Prisma } from "@prisma/client";
import { prisma } from "../../src/db/prisma";
import { FakeAiProvider } from "../../src/services/ai-provider.service";
import { AiRetrievalService } from "../../src/services/ai-retrieval.service";
import type { AiConfig } from "../../src/config/ai";

jest.mock("../../src/db/prisma", () => ({ prisma: { $queryRaw: jest.fn() } }));

const config: AiConfig = {
  enabled: true, chatModel: "chat", analysisModel: "analysis", embeddingModel: "embedding", embeddingDimensions: 1536,
  requestTimeoutMs: 30_000, maxOutputTokens: 2_000, maxToolRounds: 4, retrievalResultCount: 2,
  retrievalTokenBudget: 300, minimumRetrievalScore: 0.2, maxRetries: 1,
  messagesPerMinute: 20, concurrentStreamsPerUser: 2, analysesPerStartupPerDay: 20, queuedAnalysesPerStartup: 4, chatRetentionDays: 0,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: "chunk-1", content: "Revenue grew 20 percent month over month.", tokenCount: 80,
    pageNumber: null, sectionLabel: "Traction", charStart: 0, charEnd: 100,
    documentId: "doc-1", documentVersionId: "version-1", documentTitle: "Pitch deck", versionNumber: 2, score: 0.91,
    ...overrides,
  };
}

describe("AI document retrieval", () => {
  beforeEach(() => jest.clearAllMocks());

  it("filters by startup and exact pinned versions inside the vector query", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([row()]);
    const provider = new FakeAiProvider();
    const service = new AiRetrievalService(provider, config);
    const result = await service.retrieveDocumentContext({
      startupId: "startup-a", query: "How fast is revenue growing?", pinnedDocumentVersionIds: ["version-1"],
    });

    const sql = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as Prisma.Sql;
    expect(sql.strings.join(" ")).toContain("document.startup_id");
    expect(sql.strings.join(" ")).toContain("version.id IN");
    expect(sql.values).toContain("startup-a");
    expect(sql.values).toContain("version-1");
    expect(result[0]?.citation).toMatchObject({ sourceType: "document_chunk", documentChunkId: "chunk-1" });
    expect(result[0]?.citation.metadata.pageNumber).toBeNull();
  });

  it("deduplicates overlapping chunks and honours the context token budget", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      row(),
      row({ chunkId: "chunk-overlap", charStart: 20, charEnd: 110, score: 0.9 }),
      row({ chunkId: "chunk-2", charStart: 200, charEnd: 300, tokenCount: 250, content: "A distinct but too-large chunk." }),
      row({ chunkId: "chunk-3", charStart: 400, charEnd: 500, tokenCount: 120, content: "A distinct eligible chunk." }),
    ]);
    const service = new AiRetrievalService(new FakeAiProvider(), config);
    const result = await service.retrieveDocumentContext({ startupId: "startup-a", query: "traction" });

    expect(result.map((item) => item.chunkId)).toEqual(["chunk-1", "chunk-3"]);
  });

  it("rejects an excessive pinned-version list before querying or embedding", async () => {
    const provider = new FakeAiProvider();
    const service = new AiRetrievalService(provider, config);
    await expect(service.retrieveDocumentContext({ startupId: "startup-a", query: "x", pinnedDocumentVersionIds: Array.from({ length: 11 }, (_, i) => `version-${i}`) }))
      .rejects.toThrow("at most 10");
    expect(provider.requests).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
