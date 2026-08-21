import { prisma } from "../../src/db/prisma";
import { AiToolsService, toolSchemasFor } from "../../src/services/ai-tools.service";
import { investorService } from "../../src/services/investor.service";
import { pipelineService } from "../../src/services/pipeline.service";
import { interactionLogService } from "../../src/services/interaction-log.service";
import { taskService } from "../../src/services/task.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startup: { findUnique: jest.fn() },
    startupInvestor: { findUnique: jest.fn() },
    documentVersion: { findMany: jest.fn() },
    reviewerInvitationDocument: { groupBy: jest.fn() },
    commitment: { findMany: jest.fn() },
  },
}));

jest.mock("../../src/services/investor.service", () => ({ investorService: { listInvestors: jest.fn() } }));
jest.mock("../../src/services/pipeline.service", () => ({ pipelineService: { getAnalytics: jest.fn(), getFocus: jest.fn(), getByStage: jest.fn() } }));
jest.mock("../../src/services/interaction-log.service", () => ({ interactionLogService: { listLogsByInvestor: jest.fn() } }));
jest.mock("../../src/services/task.service", () => ({ taskService: { listTasks: jest.fn() } }));

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
    await new AiToolsService().execute("startup-a", "list_investors", { roundId: null, stage: null }, ["list_investors"]);
    expect(investorService.listInvestors).toHaveBeenCalledWith("startup-a", expect.not.objectContaining({ search: expect.anything() }));
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
    (taskService.listTasks as jest.Mock).mockResolvedValue({ data: [], meta: {} });
    await new AiToolsService().execute("startup-a", "list_tasks", { roundId: null, status: "open", assigneeId: null }, ["list_tasks"]);
    expect(taskService.listTasks).toHaveBeenCalledWith("startup-a", expect.objectContaining({ status: "open" }));
    const call = (taskService.listTasks as jest.Mock).mock.calls[0][1];
    expect(call).not.toHaveProperty("roundId");
    expect(call).not.toHaveProperty("assigneeId");
  });
});
