import { prisma } from "../../src/db/prisma";
import { AiToolsService, toolSchemasFor } from "../../src/services/ai-tools.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startup: { findUnique: jest.fn() },
    startupInvestor: { findUnique: jest.fn() },
    documentVersion: { findMany: jest.fn() },
    reviewerInvitationDocument: { groupBy: jest.fn() },
  },
}));

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
});
