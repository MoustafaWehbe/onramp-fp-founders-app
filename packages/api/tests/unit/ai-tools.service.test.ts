import { prisma } from "../../src/db/prisma";
import { AiToolsService, toolSchemasFor } from "../../src/services/ai-tools.service";
import { investorService } from "../../src/services/investor.service";
import { pipelineService } from "../../src/services/pipeline.service";
import { interactionLogService } from "../../src/services/interaction-log.service";
import { taskService } from "../../src/services/task.service";
import { chatService } from "../../src/services/chat.service";
import { aiActionsService } from "../../src/services/ai-actions.service";
import { gmailSendService } from "../../src/services/gmail-send.service";
import { calendarEventService } from "../../src/services/calendar-event.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startup: { findUnique: jest.fn() },
    startupInvestor: { findUnique: jest.fn() },
    documentVersion: { findMany: jest.fn() },
    reviewerInvitationDocument: { groupBy: jest.fn() },
    commitment: { findMany: jest.fn() },
    startupMember: { findUnique: jest.fn() },
    interactionLog: { findMany: jest.fn() },
  },
}));

jest.mock("../../src/services/investor.service", () => ({ investorService: { listInvestors: jest.fn() } }));
jest.mock("../../src/services/pipeline.service", () => ({ pipelineService: { getAnalytics: jest.fn(), getFocus: jest.fn(), getByStage: jest.fn() } }));
jest.mock("../../src/services/interaction-log.service", () => ({ interactionLogService: { listLogsByInvestor: jest.fn() } }));
jest.mock("../../src/services/task.service", () => ({ taskService: { listTasks: jest.fn() } }));
jest.mock("../../src/services/chat.service", () => ({ chatService: { listConversations: jest.fn(), searchMessages: jest.fn() } }));
jest.mock("../../src/services/ai-actions.service", () => ({ aiActionsService: { proposeAction: jest.fn() } }));
jest.mock("../../src/services/gmail-send.service", () => ({ gmailSendService: { sendInvestorEmail: jest.fn() } }));
jest.mock("../../src/services/calendar-event.service", () => ({ calendarEventService: { scheduleMeeting: jest.fn() } }));

describe("AI structured tools", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects a financial tool before it can query application data", async () => {
    await expect(new AiToolsService().execute("startup-a", "get_round_health", {}, [])).rejects.toThrow("AI_TOOL_FORBIDDEN");
    expect(prisma.startupInvestor.findUnique).not.toHaveBeenCalled();
  });

  it("uses the caller startup in the investor composite key", async () => {
    (prisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue(null);
    await new AiToolsService().execute("startup-a", "get_investor_context", {
      investorId: "00000000-0000-0000-0000-000000000001",
    }, ["get_investor_context"]);
    expect(prisma.startupInvestor.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { startupId_id: { startupId: "startup-a", id: "00000000-0000-0000-0000-000000000001" } },
    }));
  });

  it("only exposes tool schemas the caller's grants actually allow the model", () => {
    const schemas = toolSchemasFor(["get_pipeline_summary"]);
    expect(schemas.map((schema) => schema.name)).toEqual(["get_pipeline_summary"]);
    expect(schemas[0]).toMatchObject({ type: "function", strict: true });
  });

  it("marks optional tool arguments nullable so strict function calling can omit them", () => {
    const schemas = toolSchemasFor(["get_round_health"]);
    const properties = schemas[0].parameters.properties as Record<string, { type: unknown }>;
    expect(properties.roundId.type).toEqual(["string", "null"]);
    expect(schemas[0].parameters.required).toEqual(["roundId"]);
  });

  it("scopes a null round argument to the conversation's pinned round", async () => {
    (pipelineService.getFocus as jest.Mock).mockResolvedValue({ data: [] });
    await new AiToolsService().execute(
      "startup-a",
      "get_focus_deals",
      { roundId: null },
      ["get_focus_deals"],
      { roundId: "00000000-0000-0000-0000-000000000007" },
    );
    expect(pipelineService.getFocus).toHaveBeenCalledWith("startup-a", "00000000-0000-0000-0000-000000000007");
  });

  it("accepts an explicit null for an optional argument, the same as omitting it", async () => {
    (prisma.documentVersion.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.reviewerInvitationDocument.groupBy as jest.Mock).mockResolvedValue([]);
    await new AiToolsService().execute("startup-a", "get_reviewer_engagement", { documentId: null }, ["get_reviewer_engagement"]);
    expect(prisma.documentVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { document: { startupId: "startup-a" } },
    }));
  });

  it("omits commitment amounts from investor context without financial:read", async () => {
    (prisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({
      id: "inv-1", fullName: "Ana Ruiz", ventureFirm: null, investorType: null, sectorFocus: null,
      description: null, checkSizeMin: null, checkSizeMax: null, geographyFocus: null, portfolioHighlights: null, warmIntroPath: null,
      notes: null, pipeline: [], interactionLogs: [],
    });
    const result = await new AiToolsService().execute("startup-a", "get_investor_context", {
      investorId: "00000000-0000-0000-0000-000000000001",
    }, ["get_investor_context"], { canReadFinancial: false });
    expect(prisma.commitment.findMany).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("commitments");
  });

  it("adds commitment amounts to investor context only with financial:read", async () => {
    (prisma.startupInvestor.findUnique as jest.Mock).mockResolvedValue({
      id: "inv-1", fullName: "Ana Ruiz", ventureFirm: null, investorType: null, sectorFocus: null,
      description: null, checkSizeMin: null, checkSizeMax: null, geographyFocus: null, portfolioHighlights: null, warmIntroPath: null,
      notes: null, pipeline: [], interactionLogs: [],
    });
    (prisma.commitment.findMany as jest.Mock).mockResolvedValue([{ amount: { toString: () => "50000" } as any, status: "wired", expectedCloseDate: null }]);
    const result = await new AiToolsService().execute("startup-a", "get_investor_context", {
      investorId: "00000000-0000-0000-0000-000000000001",
    }, ["get_investor_context"], { canReadFinancial: true });
    expect(prisma.commitment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { startupId: "startup-a", startupInvestorId: "00000000-0000-0000-0000-000000000001" },
    }));
    expect(result).toMatchObject({ commitments: [{ amount: 50000, status: "wired", expectedCloseDate: null }] });
  });

  it("resolves an investor by name via search_investors, the entry point for a name-only reference", async () => {
    (investorService.listInvestors as jest.Mock).mockResolvedValue({ data: [{ id: "inv-1", fullName: "Ana Ruiz" }], meta: {} });
    await new AiToolsService().execute("startup-a", "search_investors", { query: "Ana" }, ["search_investors"]);
    expect(investorService.listInvestors).toHaveBeenCalledWith("startup-a", expect.objectContaining({ search: "Ana" }));
  });

  it("lists investors without a search term for list_investors", async () => {
    (investorService.listInvestors as jest.Mock).mockResolvedValue({ data: [], meta: {} });
    await new AiToolsService().execute("startup-a", "list_investors", { roundId: null, stage: null, scope: "team" }, ["list_investors"]);
    expect(investorService.listInvestors).toHaveBeenCalledWith("startup-a", expect.objectContaining({ pipelineOnly: true }));
    expect(investorService.listInvestors).toHaveBeenCalledWith("startup-a", expect.not.objectContaining({ search: expect.anything() }));
  });

  it("resolves 'my investors' to the caller's member id and never the whole directory", async () => {
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue({ id: "member-7", status: "active" });
    (investorService.listInvestors as jest.Mock).mockResolvedValue({ data: [], meta: {} });

    await new AiToolsService().execute(
      "startup-a",
      "list_investors",
      { roundId: null, stage: null, scope: "mine" },
      ["list_investors"],
      { userId: "user-1", roundId: "00000000-0000-0000-0000-000000000007" },
    );

    expect(investorService.listInvestors).toHaveBeenCalledWith("startup-a", expect.objectContaining({
      ownerId: "member-7",
      pipelineOnly: true,
      roundId: "00000000-0000-0000-0000-000000000007",
    }));
  });

  it("builds a complete daily briefing from owned deals, personal tasks, meetings, and focus signals", async () => {
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue({ id: "member-7", status: "active" });
    (investorService.listInvestors as jest.Mock).mockResolvedValue({ data: [], meta: { total: 0 } });
    (pipelineService.getFocus as jest.Mock).mockResolvedValue({ data: [] });
    (taskService.listTasks as jest.Mock).mockResolvedValue({ data: [], meta: { total: 0 } });
    (prisma.interactionLog.findMany as jest.Mock).mockResolvedValue([]);

    const result = await new AiToolsService().execute(
      "startup-a",
      "get_daily_briefing",
      { roundId: null },
      ["get_daily_briefing"],
      { userId: "user-1", roundId: "00000000-0000-0000-0000-000000000007", canReadFinancial: false },
    ) as { assignedInvestors: { total: number }; tasks: { totalOpen: number }; meetings: unknown[]; roundHealth: unknown };

    expect(investorService.listInvestors).toHaveBeenCalledWith("startup-a", expect.objectContaining({ ownerId: "member-7", pipelineOnly: true }));
    expect(pipelineService.getFocus).toHaveBeenCalledWith("startup-a", "00000000-0000-0000-0000-000000000007", "member-7");
    expect(taskService.listTasks).toHaveBeenCalledWith("startup-a", expect.objectContaining({ assigneeId: "member-7", status: "open" }));
    expect(result).toMatchObject({ assignedInvestors: { total: 0 }, tasks: { totalOpen: 0 }, meetings: [], roundHealth: null });
  });

  it("groups deals by stage via get_pipeline_by_stage", async () => {
    (pipelineService.getByStage as jest.Mock).mockResolvedValue({ data: [] });
    await new AiToolsService().execute("startup-a", "get_pipeline_by_stage", { roundId: null }, ["get_pipeline_by_stage"]);
    expect(pipelineService.getByStage).toHaveBeenCalledWith("startup-a", null);
  });

  it("reads investor interaction history newest-first via get_interaction_history", async () => {
    (interactionLogService.listLogsByInvestor as jest.Mock).mockResolvedValue({ data: [], meta: {} });
    await new AiToolsService().execute("startup-a", "get_interaction_history", { investorId: "00000000-0000-0000-0000-000000000001" }, ["get_interaction_history"]);
    expect(interactionLogService.listLogsByInvestor).toHaveBeenCalledWith("startup-a", "00000000-0000-0000-0000-000000000001", expect.objectContaining({ page: 1 }));
  });

  it("lists tasks via list_tasks, dropping null filters rather than passing them through", async () => {
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue({ id: "member-1", status: "active" });
    (taskService.listTasks as jest.Mock).mockResolvedValue({ data: [], meta: {} });
    await new AiToolsService().execute("startup-a", "list_tasks", { roundId: null, status: "open" }, ["list_tasks"], { userId: "user-1" });
    expect(taskService.listTasks).toHaveBeenCalledWith("startup-a", expect.objectContaining({ status: "open" }));
    const call = (taskService.listTasks as jest.Mock).mock.calls[0][1];
    expect(call).not.toHaveProperty("roundId");
  });

  it("scopes list_tasks to the caller's own resolved member id, never a model-supplied assignee", async () => {
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue({ id: "member-9", status: "active" });
    (taskService.listTasks as jest.Mock).mockResolvedValue({ data: [], meta: {} });
    await new AiToolsService().execute("startup-a", "list_tasks", { roundId: null, status: null }, ["list_tasks"], { userId: "user-1" });
    expect(prisma.startupMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { startupId_userId: { startupId: "startup-a", userId: "user-1" } } }));
    expect(taskService.listTasks).toHaveBeenCalledWith("startup-a", expect.objectContaining({ assigneeId: "member-9" }));
  });

  it("filters the caller's tasks by investor and the pinned round", async () => {
    const INVESTOR_ID = "00000000-0000-0000-0000-000000000008";
    const ROUND_ID = "00000000-0000-0000-0000-000000000007";
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue({ id: "member-9", status: "active" });
    (taskService.listTasks as jest.Mock).mockResolvedValue({ data: [], meta: {} });

    await new AiToolsService().execute(
      "startup-a",
      "list_tasks",
      { investorId: INVESTOR_ID, roundId: null, status: null },
      ["list_tasks"],
      { userId: "user-1", roundId: ROUND_ID },
    );

    expect(taskService.listTasks).toHaveBeenCalledWith("startup-a", expect.objectContaining({
      assigneeId: "member-9",
      investorId: INVESTOR_ID,
      roundId: ROUND_ID,
    }));
  });

  it("can return every team task for an investor without accepting a model-supplied assignee id", async () => {
    const INVESTOR_ID = "00000000-0000-0000-0000-000000000008";
    (taskService.listTasks as jest.Mock).mockResolvedValue({ data: [], meta: {} });

    await new AiToolsService().execute(
      "startup-a",
      "list_tasks",
      { investorId: INVESTOR_ID, roundId: null, status: null, scope: "team" },
      ["list_tasks"],
      { userId: "user-1" },
    );

    const query = (taskService.listTasks as jest.Mock).mock.calls[0][1];
    expect(query).toMatchObject({ investorId: INVESTOR_ID });
    expect(query).not.toHaveProperty("assigneeId");
    expect(prisma.startupMember.findUnique).not.toHaveBeenCalled();
  });

  it("refuses list_tasks without an authenticated identity to scope it to", async () => {
    await expect(new AiToolsService().execute("startup-a", "list_tasks", { roundId: null, status: null }, ["list_tasks"], {}))
      .rejects.toThrow("AI_TOOL_FORBIDDEN");
    expect(taskService.listTasks).not.toHaveBeenCalled();
  });

  it("resolves the caller's own member id from their authenticated userId before reading chat", async () => {
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue({ id: "member-1", status: "active" });
    (chatService.listConversations as jest.Mock).mockResolvedValue({ data: [] });
    await new AiToolsService().execute("startup-a", "list_team_conversations", {}, ["list_team_conversations"], { userId: "user-1" });
    expect(prisma.startupMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { startupId_userId: { startupId: "startup-a", userId: "user-1" } } }));
    expect(chatService.listConversations).toHaveBeenCalledWith("startup-a", "member-1");
  });

  it("refuses to read chat when no authenticated userId was supplied never falls back to any other identity", async () => {
    await expect(new AiToolsService().execute("startup-a", "list_team_conversations", {}, ["list_team_conversations"], {}))
      .rejects.toThrow("AI_TOOL_FORBIDDEN");
    expect(prisma.startupMember.findUnique).not.toHaveBeenCalled();
    expect(chatService.listConversations).not.toHaveBeenCalled();
  });

  it("refuses to read chat for a userId with no active membership in this startup", async () => {
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(new AiToolsService().execute("startup-a", "search_team_messages", { query: "Ana" }, ["search_team_messages"], { userId: "user-1" }))
      .rejects.toThrow("AI_TOOL_FORBIDDEN");
    expect(chatService.searchMessages).not.toHaveBeenCalled();
  });

  it("refuses to read chat for a member whose membership has been deactivated", async () => {
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue({ id: "member-1", status: "removed" });
    await expect(new AiToolsService().execute("startup-a", "search_team_messages", { query: "Ana" }, ["search_team_messages"], { userId: "user-1" }))
      .rejects.toThrow("AI_TOOL_FORBIDDEN");
    expect(chatService.searchMessages).not.toHaveBeenCalled();
  });

  it("searches team chat scoped to the resolved member id, not a model-supplied one", async () => {
    (prisma.startupMember.findUnique as jest.Mock).mockResolvedValue({ id: "member-1", status: "active" });
    (chatService.searchMessages as jest.Mock).mockResolvedValue({ data: [] });
    await new AiToolsService().execute("startup-a", "search_team_messages", { query: "Ana Ruiz" }, ["search_team_messages"], { userId: "user-1" });
    expect(chatService.searchMessages).toHaveBeenCalledWith("startup-a", "member-1", "Ana Ruiz");
  });

  describe("propose_* write tools", () => {
    const CONTEXT = { userId: "user-1", sessionId: "session-1", messageId: "message-1" };

    it("only ever proposes — a propose_* tool call never reaches the real send/schedule/write service directly", async () => {
      (aiActionsService.proposeAction as jest.Mock).mockResolvedValue({ id: "action-1", actionType: "send_investor_email", status: "proposed", expiresAt: new Date() });
      await new AiToolsService().execute("startup-a", "propose_investor_email", {
        investorId: "00000000-0000-0000-0000-000000000001", pipelineId: null, subject: "Hi", body: "Hello",
      }, ["propose_investor_email"], CONTEXT);
      expect(gmailSendService.sendInvestorEmail).not.toHaveBeenCalled();
      expect(calendarEventService.scheduleMeeting).not.toHaveBeenCalled();
    });

    it("maps the tool name to the stored actionType and strips model-supplied nulls before proposing", async () => {
      (aiActionsService.proposeAction as jest.Mock).mockResolvedValue({ id: "action-1", actionType: "create_task", status: "proposed", expiresAt: new Date() });
      await new AiToolsService().execute("startup-a", "propose_task", {
        pipelineId: "00000000-0000-0000-0000-000000000001", title: "Follow up", description: null, priority: null, dueDate: null, assigneeId: null,
      }, ["propose_task"], CONTEXT);

      expect(aiActionsService.proposeAction).toHaveBeenCalledWith(
        "startup-a", "session-1", "message-1", "user-1", "create_task",
        { pipelineId: "00000000-0000-0000-0000-000000000001", title: "Follow up" },
      );
    });

    it("returns a result that explicitly says drafted/awaiting review, never that the action happened", async () => {
      (aiActionsService.proposeAction as jest.Mock).mockResolvedValue({ id: "action-1", actionType: "create_task", status: "proposed", expiresAt: new Date() });
      const result = await new AiToolsService().execute("startup-a", "propose_task", {
        pipelineId: "00000000-0000-0000-0000-000000000001", title: "Follow up", description: null, priority: null, dueDate: null, assigneeId: null,
      }, ["propose_task"], CONTEXT) as { actionId: string; status: string; summary: string };

      expect(result.actionId).toBe("action-1");
      expect(result.status).toBe("proposed");
      expect(result.summary.toLowerCase()).toContain("awaiting");
      expect(result.summary.toLowerCase()).toContain("drafted");
    });

    it("refuses to propose without an authenticated identity to attribute it to, rather than falling back to any default", async () => {
      await expect(new AiToolsService().execute("startup-a", "propose_task", { pipelineId: "00000000-0000-0000-0000-000000000001", title: "x", description: null, priority: null, dueDate: null, assigneeId: null }, ["propose_task"], {}))
        .rejects.toThrow("AI_TOOL_FORBIDDEN");
      expect(aiActionsService.proposeAction).not.toHaveBeenCalled();
    });

    it("maps propose_task_status to the update_task_status actionType", async () => {
      (aiActionsService.proposeAction as jest.Mock).mockResolvedValue({ id: "action-1", actionType: "update_task_status", status: "proposed", expiresAt: new Date() });
      await new AiToolsService().execute("startup-a", "propose_task_status", {
        taskId: "00000000-0000-0000-0000-000000000004", status: "completed",
      }, ["propose_task_status"], CONTEXT);

      expect(aiActionsService.proposeAction).toHaveBeenCalledWith(
        "startup-a", "session-1", "message-1", "user-1", "update_task_status",
        { taskId: "00000000-0000-0000-0000-000000000004", status: "completed" },
      );
    });
  });
});
