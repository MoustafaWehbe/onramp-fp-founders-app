import { prisma } from "../../src/db/prisma";
import { AiConversationService } from "../../src/services/ai-conversation.service";
import { FakeAiProvider } from "../../src/services/ai-provider.service";
import { aiToolsService } from "../../src/services/ai-tools.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    $executeRaw: jest.fn(),
    aiChatSession: { findFirst: jest.fn(), update: jest.fn() },
    aiChatMessage: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    aiRun: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    aiToolCall: { create: jest.fn() },
    aiCitation: { createMany: jest.fn() },
    aiAnalysis: { findMany: jest.fn() },
  },
}));

// toolSchemasFor stays real (it's what builds the tool definitions the model sees);
// only execute() is stubbed so the loop never reaches a real domain service.
jest.mock("../../src/services/ai-tools.service", () => ({
  ...jest.requireActual("../../src/services/ai-tools.service"),
  aiToolsService: { execute: jest.fn() },
}));

const access = { canReadDocuments: true, canReadFinancial: true, tools: ["get_focus_deals" as const] };
const session = { id: "session-1", startupId: "startup-1", userId: "user-1", documents: [], persona: null, roundId: undefined };

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
    }, { canReadDocuments: false, canReadFinancial: true })).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(prisma.aiChatMessage.create).not.toHaveBeenCalled();
  });

  it("does not resume a round-context conversation after financial access is revoked", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue({ ...session, roundId: "round-1" });
    const service = new AiConversationService(new FakeAiProvider());
    await expect(service.submitMessage("startup-1", "user-1", "session-1", {
      content: "How is the round doing?", clientRequestId: "00000000-0000-0000-0000-000000000001",
    }, { canReadDocuments: true, canReadFinancial: false })).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(prisma.aiChatMessage.create).not.toHaveBeenCalled();
  });

  it("does not disclose historical messages or start a stream for a revoked round context", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue({ ...session, roundId: "round-1" });
    const service = new AiConversationService(new FakeAiProvider());
    const revokedAccess = { canReadDocuments: true, canReadFinancial: false };
    await expect(service.listMessages("startup-1", "user-1", "session-1", { limit: 50 }, revokedAccess))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    await expect(service.openStream("startup-1", "user-1", "session-1", "assistant-message", revokedAccess))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(prisma.aiChatMessage.findMany).not.toHaveBeenCalled();
    expect(prisma.aiChatMessage.findFirst).not.toHaveBeenCalled();
  });

  it("marks an active assistant message cancelled", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    (prisma.aiChatMessage.findFirst as jest.Mock).mockResolvedValue({ id: "assistant-message" });
    const service = new AiConversationService(new FakeAiProvider());
    await service.cancel("startup-1", "user-1", "session-1", "assistant-message");
    expect(prisma.aiChatMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
});

describe("AI conversation agent loop", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.aiRun.create as jest.Mock).mockResolvedValue({ id: "run-1" });
    (prisma.aiChatMessage.findMany as jest.Mock).mockResolvedValue([{ role: "user", content: "Who should I focus on today?" }]);
    (prisma.aiAnalysis.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.aiChatMessage.update as jest.Mock).mockResolvedValue({});
    (prisma.aiRun.update as jest.Mock).mockResolvedValue({});
    (prisma.aiChatSession.update as jest.Mock).mockResolvedValue({});
    (prisma.aiToolCall.create as jest.Mock).mockResolvedValue({});
  });

  // Access with canReadDocuments: false skips retrieval entirely, so these tests
  // exercise only the tool-calling loop without needing to mock AiRetrievalService.
  const loopAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["get_focus_deals" as const] };

  it("chains a tool call before answering: the model requests it, the server executes it, and the answer arrives on the next round", async () => {
    (aiToolsService.execute as jest.Mock).mockResolvedValue({ data: [{ investorId: "inv-1" }] });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "get_focus_deals", arguments: "{\"roundId\":null}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Focus on Ana Ruiz." }, { type: "completed", providerRequestId: "resp-2", stopReason: "stop" }],
    ];
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", loopAccess);

    expect(aiToolsService.execute).toHaveBeenCalledWith("startup-1", "get_focus_deals", { roundId: null }, ["get_focus_deals"], { canReadFinancial: true });
    expect(prisma.aiToolCall.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ toolName: "get_focus_deals", status: "completed" }) }));
    expect(prisma.aiChatMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed", content: "Focus on Ana Ruiz." }) }));
    // The second streamConversation call must carry the first round's tool call and
    // its output back to the model, not just the original user turn.
    const secondRequest = provider.requests[1].input as { input: unknown[] };
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call", callId: "call-1" }),
      expect.objectContaining({ type: "function_call_output", callId: "call-1" }),
    ]));
  });

  it("degrades to a useful answer instead of a failed message when a tool call fails", async () => {
    (aiToolsService.execute as jest.Mock).mockRejectedValue(new Error("boom"));
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "get_focus_deals", arguments: "{}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "I couldn't load your pipeline, but here's general advice." }, { type: "completed", stopReason: "stop" }],
    ];
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", loopAccess);

    expect(prisma.aiToolCall.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", errorCode: "AI_TOOL_FAILED" }) }));
    expect(prisma.aiChatMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
  });

  it("ends the turn with a plain-language message, not a failure, once the tool-call budget is exhausted", async () => {
    (aiToolsService.execute as jest.Mock).mockResolvedValue({ data: [] });
    const provider = new FakeAiProvider();
    const toolCallOnlyRound = [{ type: "tool_call" as const, callId: "call-x", name: "get_focus_deals", arguments: "{}" }, { type: "completed" as const, stopReason: "tool_calls" as const }];
    provider.streamEventsByTurn = [toolCallOnlyRound, toolCallOnlyRound, toolCallOnlyRound, toolCallOnlyRound];
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", loopAccess);

    expect(provider.requests.filter((request) => request.operation === "streamConversation")).toHaveLength(4);
    expect(prisma.aiChatMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed", content: expect.stringContaining("couldn't finish") }),
    }));
  });
});
