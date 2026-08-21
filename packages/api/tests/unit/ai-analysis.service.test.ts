import { prisma } from "../../src/db/prisma";
import { AiAnalysisService } from "../../src/services/ai-analysis.service";
import { FakeAiProvider } from "../../src/services/ai-provider.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    documentVersion: { findFirst: jest.fn() },
    aiChatSession: { findFirst: jest.fn() },
    aiAnalysis: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    aiRun: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

describe("AI analysis tenant boundaries", () => {
  beforeEach(() => jest.clearAllMocks());

  it("looks up a requested document version inside the caller startup", async () => {
    (prisma.documentVersion.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(new AiAnalysisService(new FakeAiProvider()).create("startup-a", "user-a", {
      documentVersionId: "00000000-0000-0000-0000-000000000001",
    })).rejects.toMatchObject({ statusCode: 400, code: "AI_INVALID_DOCUMENT_VERSION" });
    expect(prisma.documentVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ document: { startupId: "startup-a" } }),
    }));
  });

  it("returns not found for an analysis belonging to another startup or user", async () => {
    (prisma.aiAnalysis.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(new AiAnalysisService(new FakeAiProvider()).get("startup-b", "user-b", "analysis-a"))
      .rejects.toMatchObject({ statusCode: 404, code: "AI_ANALYSIS_NOT_FOUND" });
    expect(prisma.aiAnalysis.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "analysis-a", startupId: "startup-b", requestedBy: "user-b" }),
    }));
  });
});
