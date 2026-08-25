import { ROLE_TEMPLATES } from "../../src/config/permissions";
import { AI_TOOL_REQUIREMENTS, aiAccessInstructions, describeAiAccess, resolveAiCapabilities } from "../../src/services/ai-capabilities.service";

describe("describeAiAccess", () => {
  it("splits the copilot's readable areas by the caller's own grants", () => {
    const summary = describeAiAccess(["pipeline:read", "startup:read"]);

    expect(summary.available.map((d) => d.permission)).toEqual(["pipeline:read", "startup:read"]);
    expect(summary.denied.map((d) => d.permission)).toEqual(["financial:read", "documents:read", "chat:read"]);
  });

  it("names each area the way the Team & Roles page labels it", () => {
    const denied = describeAiAccess([]).denied;

    expect(denied.find((d) => d.permission === "financial:read")?.label).toBe("Rounds & commitments");
    expect(denied.find((d) => d.permission === "pipeline:read")?.label).toBe("Investors & pipeline");
  });

  it("denies nothing for a role that can read everything", () => {
    expect(describeAiAccess(ROLE_TEMPLATES.owner).denied).toEqual([]);
  });
});

describe("aiAccessInstructions", () => {
  it("is empty when there is nothing to disclaim, so it costs no prompt tokens", () => {
    expect(aiAccessInstructions(describeAiAccess(ROLE_TEMPLATES.owner))).toBe("");
  });

  it("tells the model to say the user lacks access rather than guess", () => {
    // The seeded viewer has no financial:read, so "how much have we raised?"
    // must not become a guess, a general-knowledge answer, or a request for
    // the founder to paste the numbers in.
    const instructions = aiAccessInstructions(describeAiAccess(ROLE_TEMPLATES.viewer));

    expect(instructions).toContain("Rounds & commitments");
    expect(instructions).toContain("do not guess");
    expect(instructions).toContain("Team & Roles");
    expect(instructions).not.toContain("Investors & pipeline");
  });

  it("covers every area whose tools were withheld", () => {
    const grants = ["ai_reports:read"];
    const summary = describeAiAccess(grants);
    const instructions = aiAccessInstructions(summary);

    // Nothing but the chat itself is readable, so the model has no data tools
    // at all and every area has to be accounted for in the prompt.
    expect(resolveAiCapabilities(grants).tools).toEqual([]);
    for (const domain of summary.denied) expect(instructions).toContain(domain.label);
  });
});

describe("tools and the access summary agree", () => {
  it("offers the team chat tools to a role that holds chat:read", () => {
    // The controller used to filter the caller's grants through a
    // hand-maintained ACCESS_GRANTS list before resolving capabilities, and
    // that list never included chat:read — so these two tools were
    // unreachable for every role.
    const tools = resolveAiCapabilities(ROLE_TEMPLATES.viewer).tools;

    expect(tools).toContain("list_team_conversations");
    expect(tools).toContain("search_team_messages");
  });

  it("never denies an area whose tools it also offers", () => {
    for (const role of Object.keys(ROLE_TEMPLATES) as (keyof typeof ROLE_TEMPLATES)[]) {
      const grants = ROLE_TEMPLATES[role] as readonly string[];
      const denied = new Set(describeAiAccess(grants).denied.map((d) => d.permission));

      for (const tool of resolveAiCapabilities(grants).tools) {
        for (const requirement of AI_TOOL_REQUIREMENTS[tool]) {
          expect([role, tool, requirement, denied.has(requirement)]).toEqual([role, tool, requirement, false]);
        }
      }
    }
  });
});
