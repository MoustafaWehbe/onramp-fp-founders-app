import { ZodError } from "zod";
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
    aiAgentAction: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
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

describe("AiConversationService.listMessages", () => {
  beforeEach(() => jest.clearAllMocks());

  it("overlays the action's live status onto an action_proposal.v1 artifact instead of its frozen snapshot", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    const artifact = {
      id: "artifact-1", artifactType: "action_proposal", schemaVersion: "v1", title: null, status: "ready", createdAt: new Date(),
      data: { actionId: "action-1", actionType: "send_investor_email", status: "proposed", payload: {}, expiresAt: new Date().toISOString() },
    };
    (prisma.aiChatMessage.findMany as jest.Mock).mockResolvedValue([
      { id: "assistant-message", role: "assistant", content: "", status: "completed", errorCode: null, errorMessage: null, createdAt: new Date(), completedAt: new Date(), citations: [], artifacts: [artifact] },
    ]);
    (prisma.aiAgentAction.findMany as jest.Mock).mockResolvedValue([{ id: "action-1", status: "executed" }]);

    const service = new AiConversationService(new FakeAiProvider());
    const [message] = await service.listMessages("startup-1", "user-1", "session-1", { limit: 50 }, access);

    // A page refresh must reflect that this proposal was already approved and
    // executed, not the "proposed" status frozen into the artifact at creation
    // time — otherwise the card re-renders an Approve button on a done action.
    expect(message.artifacts[0].data).toMatchObject({ status: "executed" });
    expect(prisma.aiAgentAction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["action-1"] }, startupId: "startup-1" } }));
  });

  it("leaves non-action artifacts untouched and skips the action lookup entirely", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    const artifact = { id: "artifact-1", artifactType: "source_answer", schemaVersion: "v1", title: null, status: "ready", createdAt: new Date(), data: { answer: "x", sources: [] } };
    (prisma.aiChatMessage.findMany as jest.Mock).mockResolvedValue([
      { id: "assistant-message", role: "assistant", content: "x", status: "completed", errorCode: null, errorMessage: null, createdAt: new Date(), completedAt: new Date(), citations: [], artifacts: [artifact] },
    ]);

    const service = new AiConversationService(new FakeAiProvider());
    const [message] = await service.listMessages("startup-1", "user-1", "session-1", { limit: 50 }, access);

    expect(message.artifacts[0].data).toEqual(artifact.data);
    expect(prisma.aiAgentAction.findMany).not.toHaveBeenCalled();
  });
});

describe("AiConversationService.openStream", () => {
  beforeEach(() => jest.clearAllMocks());

  it("claims a pending message and starts generation", async () => {
    // A messageId not reused by any other test in this file: aiStreamBroker is
    // a real module-level singleton here (not mocked), so reusing "assistant-message"
    // would pick up another test's already-published events on replay.
    const messageId = "pending-message";
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    (prisma.aiChatMessage.findFirst as jest.Mock).mockResolvedValue({ id: messageId, status: "pending", content: "" });
    (prisma.aiChatMessage.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.aiRun.create as jest.Mock).mockResolvedValue({ id: "run-1" });
    (prisma.aiChatMessage.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.aiAnalysis.findMany as jest.Mock).mockResolvedValue([]);
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [[{ type: "delta", text: "Hi" }, { type: "completed", stopReason: "stop" }]];
    const service = new AiConversationService(provider);

    const { message, replay } = await service.openStream("startup-1", "user-1", "session-1", messageId, access);

    expect(message.status).toBe("pending");
    expect(replay).toEqual([]);
    expect(prisma.aiChatMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: messageId, status: "pending" }, data: { status: "streaming" } }));
  });

  it("recovers a message orphaned by a crashed or restarted process, instead of leaving the client stuck on \"Thinking…\" forever", async () => {
    // Reproduces the reported bug: a dev hot-reload restart (or a deploy, or a
    // crash) kills the process mid-generation before it can reach either
    // terminal DB update. Nothing else was ever going to pick this back up —
    // activeRuns is in-memory and was wiped along with the process, so a
    // reconnect finds a "streaming" row with no owner.
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    (prisma.aiChatMessage.findFirst as jest.Mock).mockResolvedValue({ id: "orphan-message", status: "streaming", content: "" });
    (prisma.aiChatMessage.update as jest.Mock).mockResolvedValue({ id: "orphan-message", status: "failed", errorCode: "AI_ORPHANED" });
    const service = new AiConversationService(new FakeAiProvider());

    const { message, replay } = await service.openStream("startup-1", "user-1", "session-1", "orphan-message", access);

    expect(prisma.aiChatMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "orphan-message" },
      data: expect.objectContaining({ status: "failed", errorCode: "AI_ORPHANED" }),
    }));
    expect(message.status).toBe("failed");
    // Sequence numbers reset with the process, so a stale pre-crash replay
    // can't be trusted to carry the recovery signal — the client must fall
    // back to the plain snapshot instead, which requires an empty replay.
    expect(replay).toEqual([]);
  });

  it("leaves an already-terminal message alone and just replays it, never re-marking it", async () => {
    (prisma.aiChatSession.findFirst as jest.Mock).mockResolvedValue(session);
    (prisma.aiChatMessage.findFirst as jest.Mock).mockResolvedValue({ id: "done-message", status: "completed", content: "All set." });
    const service = new AiConversationService(new FakeAiProvider());

    const { message } = await service.openStream("startup-1", "user-1", "session-1", "done-message", access);

    expect(message.status).toBe("completed");
    expect(prisma.aiChatMessage.update).not.toHaveBeenCalled();
    expect(prisma.aiChatMessage.updateMany).not.toHaveBeenCalled();
  });
});

describe("AI conversation agent loop", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.aiRun.create as jest.Mock).mockResolvedValue({ id: "run-1" });
    (prisma.aiChatMessage.findMany as jest.Mock).mockResolvedValue([{ role: "user", content: "Who should I focus on today?" }]);
    (prisma.aiAnalysis.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.aiChatMessage.update as jest.Mock).mockResolvedValue({});
    (prisma.aiChatMessage.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
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
    expect(prisma.aiChatMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed", content: "Focus on Ana Ruiz." }) }));
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
    expect(prisma.aiChatMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
  });

  it("surfaces the specific validation issue for a bad tool argument (e.g. a hallucinated id), not a generic failure, so the model can self-correct", async () => {
    (aiToolsService.execute as jest.Mock).mockRejectedValue(new ZodError([{ code: "invalid_string", validation: "uuid", message: "Invalid uuid", path: ["investorId"] } as any]));
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "get_investor_context", arguments: "{\"investorId\":\"Elena\"}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Let me search for her instead." }, { type: "completed", stopReason: "stop" }],
    ];
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", { ...loopAccess, tools: ["get_investor_context" as const] });

    expect(prisma.aiToolCall.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", errorCode: "AI_TOOL_INVALID_ARGUMENTS" }) }));
    const secondRequest = provider.requests[1].input as { input: unknown[] };
    const toolOutput = secondRequest.input.find((item: any) => item.type === "function_call_output") as { output: string };
    expect(toolOutput.output).toContain("investorId");
    expect(toolOutput.output.toLowerCase()).toContain("never guess or invent");
  });

  it("ends the turn with a plain-language message, not a failure, once the tool-call budget is exhausted", async () => {
    (aiToolsService.execute as jest.Mock).mockResolvedValue({ data: [] });
    const provider = new FakeAiProvider();
    const toolCallOnlyRound = [{ type: "tool_call" as const, callId: "call-x", name: "get_focus_deals", arguments: "{}" }, { type: "completed" as const, stopReason: "tool_calls" as const }];
    provider.streamEventsByTurn = [toolCallOnlyRound, toolCallOnlyRound, toolCallOnlyRound, toolCallOnlyRound];
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", loopAccess);

    expect(provider.requests.filter((request) => request.operation === "streamConversation")).toHaveLength(4);
    expect(prisma.aiChatMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
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

  it("does not also render a generic email_draft.v1 card when propose_investor_email already rendered the real action_proposal.v1 card", async () => {
    (prisma.aiChatMessage.findMany as jest.Mock).mockResolvedValue([{ role: "user", content: "Please draft and send a follow-up email to Sarah about diligence." }]);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ firstName: "Muhamad", lastName: "Houda", title: "Co-Founder & CEO" });
    (aiToolsService.execute as jest.Mock).mockResolvedValue({
      actionId: "00000000-0000-0000-0000-000000000099", actionType: "send_investor_email", status: "proposed", expiresAt: new Date("2026-08-22T00:00:00.000Z"),
    });
    (prisma.aiArtifact.create as jest.Mock).mockResolvedValue({ id: "artifact-1", artifactType: "action_proposal", schemaVersion: "v1", title: "Proposed action", status: "ready", data: {} });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "propose_investor_email", arguments: "{\"investorId\":\"inv-1\",\"pipelineId\":null,\"subject\":\"Follow-up\",\"body\":\"Hi Sarah\"}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "I've drafted a follow-up email for you to review." }, { type: "completed", stopReason: "stop" }],
    ];
    const proposeAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["propose_investor_email" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", proposeAccess);

    const artifactTypes = (prisma.aiArtifact.create as jest.Mock).mock.calls.map((call) => call[0].data.artifactType);
    expect(artifactTypes).toEqual(["action_proposal"]);
    expect(artifactTypes).not.toContain("email_draft");
  });

  it("never renders an email_draft.v1 card from prompt keywords alone anymore — a real draft only ever comes from propose_investor_email", async () => {
    // Regression for a real bug: "email" + "send" in the user's prompt used to
    // create an email_draft.v1 card whose body was just the model's own reply
    // text — including a clarifying question ("could you give me the subject?")
    // rendered as if it were the email itself, alongside "No investor record
    // selected" even when one existed. That heuristic is gone; propose_investor_email
    // is the only path to a real draft now.
    (prisma.aiChatMessage.findMany as jest.Mock).mockResolvedValue([{ role: "user", content: "i want to send an email to sara chen" }]);
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [[{ type: "delta", text: "Could you tell me the subject and content you'd like to include?" }, { type: "completed", stopReason: "stop" }]];
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", loopAccess);

    const artifactTypes = (prisma.aiArtifact.create as jest.Mock).mock.calls.map((call) => call[0].data.artifactType);
    expect(artifactTypes).not.toContain("email_draft");
  });

  it("tells the model the real sender's name and title to sign drafts with, instead of leaving it to invent a placeholder", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ firstName: "Muhamad", lastName: "Houda", title: "Co-Founder & CEO" });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [[{ type: "delta", text: "Sure." }, { type: "completed", stopReason: "stop" }]];
    const proposeAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["propose_investor_email" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", proposeAccess);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-1" } }));
    const instructions = (provider.requests[0].input as { instructions: string }).instructions;
    expect(instructions).toContain("Muhamad Houda");
    expect(instructions).toContain("Co-Founder & CEO");
    expect(instructions).toContain("Never write a placeholder");
  });

  it("tells the model to re-resolve an id fresh every turn and retry a failed propose_* call, rather than reuse a remembered id or give up", async () => {
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [[{ type: "delta", text: "Sure." }, { type: "completed", stopReason: "stop" }]];
    const proposeAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["propose_investor_email" as const, "search_investors" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", proposeAccess);

    const instructions = (provider.requests[0].input as { instructions: string }).instructions;
    expect(instructions).toContain("never one you remember discussing");
    expect(instructions).toContain("immediately retry");
  });

  it("skips the sender lookup entirely when no draft-worthy tool is available this turn", async () => {
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [[{ type: "delta", text: "Sure." }, { type: "completed", stopReason: "stop" }]];
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", loopAccess);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
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
    (aiToolsService.execute as jest.Mock).mockResolvedValue({ data: [{ id: "task-1", title: "Follow up", status: "open", priority: "high", dueDate: null, assigneeId: "member-1", assignee: { name: "Maya Chen" }, investor: { id: "inv-1", fullName: "Ana Ruiz", ventureFirm: "Northstar Ventures" }, round: { id: "round-1", roundName: "Seed", status: "active" }, pipelineStage: "meeting" }] });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "list_tasks", arguments: "{\"investorId\":null,\"roundId\":null,\"status\":null}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Here are your tasks." }, { type: "completed", stopReason: "stop" }],
    ];
    const taskAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["list_tasks" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", taskAccess);

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ artifactType: "task_list", data: { tasks: [{ id: "task-1", title: "Follow up", status: "open", priority: "high", dueDate: null, assigned: true, assigneeName: "Maya Chen", investor: { id: "inv-1", fullName: "Ana Ruiz", ventureFirm: "Northstar Ventures" }, round: { id: "round-1", roundName: "Seed", status: "active" }, pipelineStage: "meeting" }] } }),
    }));
  });

  it("suppresses the task_list.v1 helper card when list_tasks was only called to resolve an id for a propose_* action this turn", async () => {
    (prisma.aiArtifact.create as jest.Mock).mockResolvedValue({ id: "artifact-1", artifactType: "action_proposal", schemaVersion: "v1", title: "Proposed action", status: "ready", data: {} });
    (aiToolsService.execute as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: "task-1", title: "Send customer reference list", status: "open", priority: "high", dueDate: null, assigneeId: "member-1" }] })
      .mockResolvedValueOnce({ actionId: "00000000-0000-0000-0000-000000000099", actionType: "update_task_status", status: "proposed", expiresAt: new Date("2026-08-22T00:00:00.000Z") });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "list_tasks", arguments: "{\"roundId\":null,\"status\":null}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "tool_call", callId: "call-2", name: "propose_task_status", arguments: "{\"taskId\":\"task-1\",\"status\":\"completed\"}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "I've drafted marking it done for your review." }, { type: "completed", stopReason: "stop" }],
    ];
    const access = { canReadDocuments: false, canReadFinancial: true, tools: ["list_tasks" as const, "propose_task_status" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", access);

    const artifactTypes = (prisma.aiArtifact.create as jest.Mock).mock.calls.map((call) => call[0].data.artifactType);
    expect(artifactTypes).toEqual(["action_proposal"]);
    expect(artifactTypes).not.toContain("task_list");
  });

  it("renders a daily briefing artifact and instructs prose to add insight instead of repeating its rows", async () => {
    (prisma.aiArtifact.create as jest.Mock).mockResolvedValue({ id: "artifact-1", artifactType: "daily_briefing", schemaVersion: "v1", title: "Today's briefing", status: "ready", data: {} });
    (aiToolsService.execute as jest.Mock).mockResolvedValue({
      generatedAt: "2026-08-23T08:00:00.000Z",
      assignedInvestors: { total: 1, data: [] },
      focusDeals: { data: [{ investorId: "inv-1", investor: { fullName: "Ana Ruiz" }, stage: "meeting_scheduled", reason: "today", daysQuiet: 2, nextTaskDueDate: null }] },
      tasks: { overdue: [], dueToday: [{ id: "task-1", title: "Send deck", status: "open", priority: "high", dueDate: "2026-08-23T12:00:00.000Z", investor: { fullName: "Ana Ruiz" } }], upcoming: [], totalOpen: 1 },
      meetings: [],
      roundHealth: null,
    });
    const provider = new FakeAiProvider();
    provider.streamEventsByTurn = [
      [{ type: "tool_call", callId: "call-1", name: "get_daily_briefing", arguments: "{\"roundId\":null}" }, { type: "completed", stopReason: "tool_calls" }],
      [{ type: "delta", text: "Here is today's briefing.\n\nThe meeting-stage investor should come first." }, { type: "completed", stopReason: "stop" }],
    ];
    const dailyAccess = { canReadDocuments: false, canReadFinancial: true, tools: ["get_daily_briefing" as const] };
    const service = new AiConversationService(provider);

    await (service as any).runGeneration(session, "assistant-message", "user-1", dailyAccess);

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ artifactType: "daily_briefing", data: expect.objectContaining({ assignedInvestorCount: 1 }) }),
    }));
    const instructions = (provider.requests[0].input as { instructions: string }).instructions;
    expect(instructions).toContain("do not repeat the artifact's rows");
    expect(instructions).toContain("one short introductory sentence");
  });
});
