import { prisma } from "../../src/db/prisma";
import { AiConversationService } from "../../src/services/ai-conversation.service";
import { FakeAiProvider } from "../../src/services/ai-provider.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    aiChatSession: { findFirst: jest.fn(), update: jest.fn() },
    aiChatMessage: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  },
}));

const access = { canReadDocuments: true };
const session = { id: "session-1", startupId: "startup-1", userId: "user-1", documents: [] };

describe("AI conversation persistence", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates one pending assistant message for an idempotent user request", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    (prisma.aiChatMessage.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.aiChatMessage.create as jest.Mock)
      .mockResolvedValueOnce({ id: "user-message" })
      .mockResolvedValueOnce({ id: "assistant-message", status: "pending" });
    const service = new AiConversationService(new FakeAiProvider());
    const result = await service.submitMessage("startup-1", "user-1", "session-1", {
      content: "Summarize the deck", clientRequestId: "00000000-0000-0000-0000-000000000001",
    }, access);

    expect(result).toEqual({ assistantMessageId: "assistant-message", status: "pending", created: true });
    expect(prisma.aiChatMessage.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ role: "assistant", responseToMessageId: "user-message", status: "pending" }) }));
  });

  it("returns the existing assistant response for a retried client request", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    (prisma.aiChatMessage.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: "user-message" })
      .mockResolvedValueOnce({ id: "assistant-message", status: "streaming" });
    const service = new AiConversationService(new FakeAiProvider());
    const result = await service.submitMessage("startup-1", "user-1", "session-1", {
      content: "Summarize the deck", clientRequestId: "00000000-0000-0000-0000-000000000001",
    }, access);

    expect(result).toEqual({ assistantMessageId: "assistant-message", status: "streaming", created: false });
    expect(prisma.aiChatMessage.create).not.toHaveBeenCalled();
  });

  it("refuses to generate from a session whose pinned documents are no longer authorized", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue({ ...session, documents: [{ documentVersionId: "version-1" }] });
    const service = new AiConversationService(new FakeAiProvider());
    await expect(service.submitMessage("startup-1", "user-1", "session-1", {
      content: "Summarize", clientRequestId: "00000000-0000-0000-0000-000000000001",
    }, { canReadDocuments: false })).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(prisma.aiChatMessage.create).not.toHaveBeenCalled();
  });

  it("marks an active assistant message cancelled", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    (prisma.aiChatMessage.findFirst as jest.Mock).mockResolvedValue({ id: "assistant-message" });
    const service = new AiConversationService(new FakeAiProvider());
    await service.cancel("startup-1", "user-1", "session-1", "assistant-message");
    expect(prisma.aiChatMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
});
