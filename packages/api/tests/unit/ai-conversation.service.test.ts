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
    aiArtifact: { create: jest.fn() },
  },
}));

// ai-tools.service.ts now imports ai-actions.service.ts, which imports
// gmail-send.service.ts, which imports the real BullMQ job queue — that opens
// a live Redis connection at module-load time. requireActual below still
// evaluates ai-tools.service.ts's real imports, so this must be mocked here
// too (not just left to ai-tools.service.test.ts's own mock) or the test
// process never exits.
jest.mock("../../src/services/ai-actions.service", () => ({ aiActionsService: { proposeAction: jest.fn() } }));

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

    expect(aiToolsService.execute).toHaveBeenCalledWith("startup-1", "get_focus_deals", { roundId: null }, ["get_focus_deals"], { canReadFinancial: true, userId: "user-1", sessionId: "session-1", messageId: "assistant-message" });
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

  it("surfaces a propose_* tool result as an action_proposal.v1 artifact immediately, not only at message completion", async () => {
    (aiToolsService.execute as jest.Mock).mockResolvedValue({
      actionId: "00000000-0000-0000-0000-000000000099", actionType: "create_task", status: "proposed", expiresAt: new Date("2026-08-22T00:00:00.000Z"),
    });
    (prisma.aiArtifact.create as jest.Mock).mockResolvedValue({ id: "artifact-1", artifactType: "action_proposal", schemaVersion: "v1", title: "Proposed action", status: "ready", data: {} });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "propose_task", arguments: "{\"pipelineId\":\"pipeline-1\",\"title\":\"Follow up\"}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "I've drafted a task for you to review." }, { type: "completed", stopReason: "stop" }],
    ];
    const proposeAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["propose_task" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", proposeAccess);

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        artifactType: "action_proposal",
        schemaVersion: "v1",
        data: expect.objectContaining({ actionId: "00000000-0000-0000-0000-000000000099", actionType: "create_task", status: "proposed" }),
      }),
    }));
  });

  it("renders an investor_brief.v1 card whenever get_investor_context actually finds an investor this turn", async () => {
    (aiToolsService.execute as jest.Mock).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000042", fullName: "Ana Ruiz", ventureFirm: "Acme Ventures", investorType: "vc", sectorFocus: "Fintech", description: "Thesis-driven seed investor.",
      checkSizeMin: 25_000, checkSizeMax: 100_000,
      pipeline: [{ stage: "due_diligence", stageChangedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }],
      interactionLogs: [{ type: "call", subject: "Intro call", interactionDate: new Date("2026-08-01T00:00:00.000Z") }],
    });
    (prisma.aiArtifact.create as jest.Mock).mockResolvedValue({ id: "artifact-1", artifactType: "investor_brief", schemaVersion: "v1", title: "Ana Ruiz", status: "ready", data: {} });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "get_investor_context", arguments: "{\"investorId\":\"00000000-0000-0000-0000-000000000042\"}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Here's Ana's profile." }, { type: "completed", stopReason: "stop" }],
    ];
    const contextAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["get_investor_context" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", contextAccess);

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        artifactType: "investor_brief",
        data: expect.objectContaining({ investorId: "00000000-0000-0000-0000-000000000042", fullName: "Ana Ruiz", stage: "due_diligence", daysInStage: 3 }),
      }),
    }));
  });

  it("renders a focus_list.v1 card when get_focus_deals returns deals, but not when it returns none", async () => {
    (prisma.aiArtifact.create as jest.Mock).mockResolvedValue({ id: "artifact-1", artifactType: "focus_list", schemaVersion: "v1", title: "Today's focus", status: "ready", data: {} });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "get_focus_deals", arguments: "{\"roundId\":null}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Focus on these." }, { type: "completed", stopReason: "stop" }],
    ];
    const focusAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["get_focus_deals" as const] };
    const service = new AiConversationService(provider);

    (aiToolsService.execute as jest.Mock).mockResolvedValueOnce({ data: [{ investorId: "inv-1", investor: { fullName: "Ana Ruiz" }, stage: "term_sheet", reason: "overdue", daysQuiet: 5, nextTaskDueDate: null }] });
    await (service as any).runGeneration(session, "assistant-message", "user-1", focusAccess);
    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ artifactType: "focus_list" }) }));

    jest.clearAllMocks();
    (prisma.aiChatMessage.findMany as jest.Mock).mockResolvedValue([{ role: "user", content: "Who should I focus on today?" }]);
    (prisma.aiAnalysis.findMany as jest.Mock).mockResolvedValue([]);
    (aiToolsService.execute as jest.Mock).mockResolvedValueOnce({ data: [] });
    const emptyProvider = new FakeAiProvider();
    emptyProvider.streamEventsByTurn = provider.streamEventsByTurn;
    const emptyService = new AiConversationService(emptyProvider);
    await (emptyService as any).runGeneration(session, "assistant-message", "user-1", focusAccess);
    expect(prisma.aiArtifact.create).not.toHaveBeenCalled();
  });

  it("renders a pipeline_board.v1 card only when at least one stage actually has deals in it", async () => {
    (prisma.aiArtifact.create as jest.Mock).mockResolvedValue({ id: "artifact-1", artifactType: "pipeline_board", schemaVersion: "v1", title: "Pipeline", status: "ready", data: {} });
    (aiToolsService.execute as jest.Mock).mockResolvedValue({ data: [{ stage: "sourced", count: 0, totalValue: 0 }, { stage: "committed", count: 2, totalValue: 500_000 }] });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "get_pipeline_by_stage", arguments: "{\"roundId\":null}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Here's the board." }, { type: "completed", stopReason: "stop" }],
    ];
    const boardAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["get_pipeline_by_stage" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", boardAccess);

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ artifactType: "pipeline_board", data: { stages: [{ stage: "sourced", count: 0, totalValue: 0 }, { stage: "committed", count: 2, totalValue: 500_000 }] } }),
    }));
  });

  it("renders a task_list.v1 card from list_tasks, marking assignment by presence of an assigneeId, not by name", async () => {
    (prisma.aiArtifact.create as jest.Mock).mockResolvedValue({ id: "artifact-1", artifactType: "task_list", schemaVersion: "v1", title: "Tasks", status: "ready", data: {} });
    (aiToolsService.execute as jest.Mock).mockResolvedValue({ data: [{ id: "task-1", title: "Follow up", status: "open", priority: "high", dueDate: null, assigneeId: "member-1" }] });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "list_tasks", arguments: "{\"roundId\":null,\"status\":null,\"assigneeId\":null}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Here are your tasks." }, { type: "completed", stopReason: "stop" }],
    ];
    const taskAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["list_tasks" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", taskAccess);

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ artifactType: "task_list", data: { tasks: [{ id: "task-1", title: "Follow up", status: "open", priority: "high", dueDate: null, assigned: true }] } }),
    }));
  });
});
