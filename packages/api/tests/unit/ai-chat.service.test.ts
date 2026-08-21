import { AiChatService } from "../../src/services/ai-chat.service";
import { prisma } from "../../src/db/prisma";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    aiChatSession: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    documentVersion: { findMany: jest.fn() },
    fundraisingRound: { findUnique: jest.fn() },
  },
}));

const service = new AiChatService();
const restricted = { canReadDocuments: false, canReadFinancial: false };
const fullAccess = { canReadDocuments: true, canReadFinancial: true };

describe("AI chat sessions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not look up or disclose a round when financial access is absent", async () => {
    await expect(service.createSession("startup-1", "user-1", {
      contextMode: "selected", documentVersionIds: [], roundId: "00000000-0000-0000-0000-000000000001",
    }, restricted)).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(prisma.fundraisingRound.findUnique).not.toHaveBeenCalled();
  });

  it("does not look up pinned documents when document access is absent", async () => {
    await expect(service.createSession("startup-1", "user-1", {
      contextMode: "selected", documentVersionIds: ["00000000-0000-0000-0000-000000000001"],
    }, restricted)).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(prisma.documentVersion.findMany).not.toHaveBeenCalled();
  });

  it("requires every pinned version to be ready and scoped to the startup", async () => {
    (prisma.documentVersion.findMany as jest.Mock).mockResolvedValue([{ id: "00000000-0000-0000-0000-000000000001", documentId: "doc-1" }]);
    (prisma.aiChatSession.create as jest.Mock).mockResolvedValue({
      id: "session-1", startupId: "startup-1", title: null, contextMode: "selected", roundId: null,
      lastMessageAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(), documents: [],
    });
    await service.createSession("startup-1", "user-1", {
      contextMode: "selected", documentVersionIds: ["00000000-0000-0000-0000-000000000001"],
    }, fullAccess);
    expect(prisma.documentVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ processingStatus: "ready", document: { startupId: "startup-1" } }),
    }));
  });

  it("returns not found for another user or startup without revealing session ownership", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.getSession("startup-2", "other-user", "session-1", restricted))
      .rejects.toMatchObject({ statusCode: 404, code: "AI_SESSION_NOT_FOUND" });
    expect(prisma.aiChatSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "session-1", startupId: "startup-2", userId: "other-user" },
    }));
  });

  it("hides document and financial context after permissions are removed", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue({
      id: "session-1", startupId: "startup-1", title: "Private", contextMode: "selected", roundId: "round-1",
      lastMessageAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const session = await service.getSession("startup-1", "user-1", "session-1", restricted);
    expect(session).not.toHaveProperty("roundId");
    expect(session).not.toHaveProperty("documents");
  });
});
