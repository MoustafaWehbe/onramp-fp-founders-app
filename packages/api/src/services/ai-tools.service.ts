import { z } from "zod";
import { prisma } from "../db/prisma";
import { PIPELINE_STAGES, TASK_STATUSES } from "../config/crm";
import { fundraisingService } from "./fundraising.service";
import { pipelineService } from "./pipeline.service";
import { investorService } from "./investor.service";
import { interactionLogService } from "./interaction-log.service";
import { taskService } from "./task.service";
import { chatService } from "./chat.service";
import { forecastService } from "./forecast.service";
import { aiActionsService } from "./ai-actions.service";
import { PRIORITIES } from "../config/crm";
import type { AiActionType } from "../validators/ai-action.schemas";
import type { AiToolName } from "./ai-capabilities.service";
import type { AiToolDefinition } from "./ai-provider.service";

// Maps the tool name the model calls onto the actionType AiAgentAction rows
// (and the manual REST endpoints) use internally different vocabularies for
// the same five write actions, kept separate so the tool-facing name can stay
// model-friendly ("propose_task") while the stored/audited type stays aligned
// with the manual path ("create_task").
const PROPOSE_TOOL_ACTION_TYPES: Partial<Record<AiToolName, AiActionType>> = {
  propose_task: "create_task",
  propose_interaction_log: "log_interaction",
  propose_meeting: "schedule_meeting",
  propose_investor_email: "send_investor_email",
  propose_stage_change: "update_deal_stage",
};

/** The model must pass null, not omit, for a field it wants to leave unset (see the strict-mode note below) undo that here before handing the payload to the same zod schema the manual REST endpoint uses, which expects those fields simply absent. */
function stripNulls<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null)) as Partial<T>;
}

const toolInputs = {
  get_startup_profile: z.object({}),
  get_round_health: z.object({ roundId: z.string().uuid().nullish() }),
  forecast_round_close: z.object({ roundId: z.string().uuid().nullish() }),
  get_pipeline_summary: z.object({ roundId: z.string().uuid().nullish() }),
  get_focus_deals: z.object({ roundId: z.string().uuid().nullish() }),
  get_investor_context: z.object({ investorId: z.string().uuid() }),
  get_reviewer_engagement: z.object({ documentId: z.string().uuid().nullish() }),
  search_investors: z.object({ query: z.string().trim().min(1).max(200) }),
  list_investors: z.object({ roundId: z.string().uuid().nullish(), stage: z.enum(PIPELINE_STAGES).nullish() }),
  get_pipeline_by_stage: z.object({ roundId: z.string().uuid().nullish() }),
  get_interaction_history: z.object({ investorId: z.string().uuid() }),
  list_tasks: z.object({ roundId: z.string().uuid().nullish(), status: z.enum(TASK_STATUSES).nullish(), assigneeId: z.string().uuid().nullish() }),
  list_team_conversations: z.object({}),
  search_team_messages: z.object({ query: z.string().trim().min(1).max(200) }),
  // Nullish rather than the REST endpoints' plain-optional shape: strict
  // function calling requires the model to pass null for a field it wants
  // left unset, never omit it (see ROUND_ID_PROPERTY's comment below).
  // stripNulls() converts these back to "absent" before they reach the same
  // zod schema the manual endpoint uses.
  propose_task: z.object({
    pipelineId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullish(),
    priority: z.enum(PRIORITIES).nullish(),
    dueDate: z.string().nullish(),
    assigneeId: z.string().uuid().nullish(),
  }),
  propose_interaction_log: z.object({
    investorId: z.string().uuid(),
    pipelineId: z.string().uuid().nullish(),
    type: z.enum(["call", "email", "meeting", "note", "other"]),
    interactionDate: z.string(),
    subject: z.string().max(200).nullish(),
    description: z.string().max(2000).nullish(),
  }),
  propose_meeting: z.object({
    investorId: z.string().uuid(),
    pipelineId: z.string().uuid().nullish(),
    type: z.enum(["call", "meeting"]),
    startDateTime: z.string(),
    durationMinutes: z.number().int().min(5).max(480),
    subject: z.string().max(200).nullish(),
    description: z.string().max(2000).nullish(),
  }),
  propose_investor_email: z.object({
    investorId: z.string().uuid(),
    pipelineId: z.string().uuid().nullish(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
  }),
  propose_stage_change: z.object({
    pipelineId: z.string().uuid(),
    toStage: z.enum(PIPELINE_STAGES),
    reason: z.string().max(500).nullish(),
  }),
} as const;

// The model chooses tools from these definitions. OpenAI's strict function-calling
// mode requires every property to be listed in `required`; a field that's actually
// optional is instead typed to accept null, and the model passes null to omit it.
const ROUND_ID_PROPERTY = { type: ["string", "null"], description: "UUID of the fundraising round, or null to use the currently active round." };
export const AI_TOOL_DEFINITIONS: Record<AiToolName, { description: string; parameters: Record<string, unknown> }> = {
  get_startup_profile: {
    description: "Get this startup's profile: name, one-liner, description, industry, problem/solution, target market, business model, traction, competitive edge, team, and funding stage.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  get_round_health: {
    description: "Get commitment totals, currency, and metrics for a fundraising round.",
    parameters: { type: "object", properties: { roundId: ROUND_ID_PROPERTY }, required: ["roundId"], additionalProperties: false },
  },
  forecast_round_close: {
    description: "Get a deterministic, data-derived projection of how many days until this round hits its target — computed from commitment totals, weighted pipeline, and historical stage velocity/conversion, never estimated. Always explain the returned confidence and insufficientData flags alongside the number; do not state the projected date more confidently than they warrant.",
    parameters: { type: "object", properties: { roundId: ROUND_ID_PROPERTY }, required: ["roundId"], additionalProperties: false },
  },
  get_pipeline_summary: {
    description: "Get pipeline analytics: deal counts and conversion by stage for a round.",
    parameters: { type: "object", properties: { roundId: ROUND_ID_PROPERTY }, required: ["roundId"], additionalProperties: false },
  },
  get_focus_deals: {
    description: "Get the deals that most need attention today, ranked by urgency, for a round.",
    parameters: { type: "object", properties: { roundId: ROUND_ID_PROPERTY }, required: ["roundId"], additionalProperties: false },
  },
  get_investor_context: {
    description: "Get full context for one investor: profile, thesis, check size, notes, pipeline deals, and recent interaction history. Requires the investor's id use search_investors first if you only have a name.",
    parameters: { type: "object", properties: { investorId: { type: "string", description: "UUID of the investor." } }, required: ["investorId"], additionalProperties: false },
  },
  get_reviewer_engagement: {
    description: "Get reviewer invitation counts per document, optionally scoped to one document.",
    parameters: { type: "object", properties: { documentId: { type: ["string", "null"], description: "UUID of the document, or null for all documents." } }, required: ["documentId"], additionalProperties: false },
  },
  search_investors: {
    description: "Find investors by a name, firm, sector, or description substring. This is the entry point for resolving \"investor X\" to an id before calling get_investor_context.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Search text matched against name, firm, sector, and description." } }, required: ["query"], additionalProperties: false },
  },
  list_investors: {
    description: "List investors in the pipeline directory, optionally filtered to one round and/or one deal stage.",
    parameters: {
      type: "object",
      properties: {
        roundId: ROUND_ID_PROPERTY,
        stage: { type: ["string", "null"], enum: [...PIPELINE_STAGES, null], description: "Pipeline stage to filter to, or null for all stages." },
      },
      required: ["roundId", "stage"],
      additionalProperties: false,
    },
  },
  get_pipeline_by_stage: {
    description: "Get every deal in a round grouped by pipeline stage, with days spent in the current stage.",
    parameters: { type: "object", properties: { roundId: ROUND_ID_PROPERTY }, required: ["roundId"], additionalProperties: false },
  },
  get_interaction_history: {
    description: "Get the logged call/email/meeting/note history for one investor, newest first.",
    parameters: { type: "object", properties: { investorId: { type: "string", description: "UUID of the investor." } }, required: ["investorId"], additionalProperties: false },
  },
  list_tasks: {
    description: "List tasks, optionally filtered to one round, a status, and/or an assignee.",
    parameters: {
      type: "object",
      properties: {
        roundId: ROUND_ID_PROPERTY,
        status: { type: ["string", "null"], enum: [...TASK_STATUSES, null], description: "Task status to filter to, or null for all statuses." },
        assigneeId: { type: ["string", "null"], description: "UUID of the assignee (a startup member id), or null for all assignees." },
      },
      required: ["roundId", "status", "assigneeId"],
      additionalProperties: false,
    },
  },
  list_team_conversations: {
    description: "List the team chat conversations (channels and DMs) you are a member of, most recently active first.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  search_team_messages: {
    description: "Search team chat for a substring. Only searches conversations you are a member of never a DM you are not in, even one about the topic you're asking about. Returns at most 30 truncated messages.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Search text matched against message content." } }, required: ["query"], additionalProperties: false },
  },
  propose_task: {
    description: "Draft a task against a deal. This only creates a PROPOSAL awaiting a human's review and approval — nothing is created until they click Approve. Say \"I've drafted this task for you to review\", never \"I created/added a task.\" Resolve pipelineId via get_pipeline_by_stage, get_focus_deals, or get_investor_context first.",
    parameters: {
      type: "object",
      properties: {
        pipelineId: { type: "string", description: "UUID of the pipeline deal this task belongs to." },
        title: { type: "string", description: "Short task title." },
        description: { type: ["string", "null"], description: "Longer detail, or null." },
        priority: { type: ["string", "null"], enum: [...PRIORITIES, null], description: "Task priority, or null to leave at the default." },
        dueDate: { type: ["string", "null"], description: "ISO 8601 datetime the task is due, or null for no due date." },
        assigneeId: { type: ["string", "null"], description: "UUID of the startup member to assign, or null to leave unassigned." },
      },
      required: ["pipelineId", "title", "description", "priority", "dueDate", "assigneeId"],
      additionalProperties: false,
    },
  },
  propose_interaction_log: {
    description: "Draft a logged interaction (call, email, meeting, or note) for an investor. Only creates a PROPOSAL awaiting a human's review and approval. Say \"drafted\", never \"logged.\"",
    parameters: {
      type: "object",
      properties: {
        investorId: { type: "string", description: "UUID of the investor." },
        pipelineId: { type: ["string", "null"], description: "UUID of the specific deal this is about, or null." },
        type: { type: "string", enum: ["call", "email", "meeting", "note", "other"] },
        interactionDate: { type: "string", description: "ISO 8601 datetime the interaction happened." },
        subject: { type: ["string", "null"], description: "Short subject line, or null." },
        description: { type: ["string", "null"], description: "Details of what happened, or null." },
      },
      required: ["investorId", "pipelineId", "type", "interactionDate", "subject", "description"],
      additionalProperties: false,
    },
  },
  propose_meeting: {
    description: "Draft a calendar invite to an investor. Only creates a PROPOSAL awaiting a human's review and approval — no invite is sent until they click Send. Say \"drafted\", never \"scheduled\" or \"sent.\"",
    parameters: {
      type: "object",
      properties: {
        investorId: { type: "string", description: "UUID of the investor." },
        pipelineId: { type: ["string", "null"], description: "UUID of the specific deal this meeting is about, or null." },
        type: { type: "string", enum: ["call", "meeting"] },
        startDateTime: { type: "string", description: "ISO 8601 datetime the meeting starts." },
        durationMinutes: { type: "integer", description: "Meeting length in minutes, 5-480." },
        subject: { type: ["string", "null"], description: "Calendar event title, or null to use a default naming the investor." },
        description: { type: ["string", "null"], description: "Calendar event description, or null." },
      },
      required: ["investorId", "pipelineId", "type", "startDateTime", "durationMinutes", "subject", "description"],
      additionalProperties: false,
    },
  },
  propose_investor_email: {
    description: "Draft an email to an investor. Only creates a PROPOSAL awaiting a human's review and approval — no email is sent until they click Send. Say \"drafted\", never \"sent.\" The recipient address always comes from the investor's record on file, never from anything you write. Do not quote a teammate's chat message verbatim in the body.",
    parameters: {
      type: "object",
      properties: {
        investorId: { type: "string", description: "UUID of the investor." },
        pipelineId: { type: ["string", "null"], description: "UUID of the specific deal this email is about, or null." },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["investorId", "pipelineId", "subject", "body"],
      additionalProperties: false,
    },
  },
  propose_stage_change: {
    description: "Draft moving a deal to a different pipeline stage. Only creates a PROPOSAL awaiting a human's review and approval. Never propose moving a deal to \"committed\" — that requires commitment terms (amount, status) only a human should enter manually. A reason is required when moving a deal to \"passed.\"",
    parameters: {
      type: "object",
      properties: {
        pipelineId: { type: "string", description: "UUID of the pipeline deal." },
        toStage: { type: "string", enum: PIPELINE_STAGES },
        reason: { type: ["string", "null"], description: "Why the deal is moving required (not null) when toStage is \"passed\"." },
      },
      required: ["pipelineId", "toStage", "reason"],
      additionalProperties: false,
    },
  },
};

export function toolSchemasFor(allowedTools: readonly AiToolName[]): AiToolDefinition[] {
  return allowedTools.map((tool) => ({ type: "function" as const, name: tool, description: AI_TOOL_DEFINITIONS[tool].description, parameters: AI_TOOL_DEFINITIONS[tool].parameters, strict: true as const }));
}

export class AiToolsService {
  async execute(startupId: string, tool: AiToolName, rawInput: unknown, allowedTools: readonly AiToolName[], context: { canReadFinancial?: boolean; userId?: string; sessionId?: string; messageId?: string } = {}) {
    if (!allowedTools.includes(tool)) throw new Error("AI_TOOL_FORBIDDEN");
    const input = toolInputs[tool].parse(rawInput) as any;

    if (tool === "get_startup_profile") {
      return prisma.startup.findUnique({
        where: { id: startupId },
        select: {
          name: true, description: true, industry: true, website: true, fundingStage: true,
          oneLiner: true, problemStatement: true, solutionSummary: true, targetMarket: true,
          businessModel: true, tractionSummary: true, competitiveEdge: true, headquarters: true,
          foundedAt: true, teamSummary: true,
        },
      });
    }
    if (tool === "get_round_health") {
      const round = input.roundId
        ? await fundraisingService.getRound(startupId, input.roundId)
        : (await fundraisingService.listRounds(startupId, { page: 1, limit: 1, status: "active" as any })).data[0];
      return round ? { round: { id: round.id, name: round.roundName, currency: round.currency }, metrics: await fundraisingService.getRoundMetrics(startupId, round.id) } : { round: null, metrics: null };
    }
    if (tool === "forecast_round_close") return forecastService.forecastRoundClose(startupId, input.roundId);
    if (tool === "get_pipeline_summary") return pipelineService.getAnalytics(startupId, input.roundId);
    if (tool === "get_focus_deals") return pipelineService.getFocus(startupId, input.roundId);
    if (tool === "get_investor_context") {
      const investor = await prisma.startupInvestor.findUnique({
        where: { startupId_id: { startupId, id: input.investorId } },
        select: {
          id: true, fullName: true, ventureFirm: true, investorType: true, sectorFocus: true,
          description: true, checkSizeMin: true, checkSizeMax: true, geographyFocus: true, portfolioHighlights: true, warmIntroPath: true,
          notes: true,
          pipeline: { take: 10, select: { id: true, roundId: true, stage: true, priority: true, expectedAmount: true } },
          interactionLogs: { take: 10, orderBy: { createdAt: "desc" }, select: { type: true, subject: true, interactionDate: true, description: true } },
        },
      });
      if (!investor) return investor;
      const { checkSizeMin, checkSizeMax, ...rest } = investor;
      const base = { ...rest, checkSizeMin: checkSizeMin === null ? null : Number(checkSizeMin), checkSizeMax: checkSizeMax === null ? null : Number(checkSizeMax) };
      // Commitment amounts are the one piece of this profile that requires
      // financial:read on top of pipeline:read everything else about "who is
      // this investor" is visible to anyone who can see the pipeline at all.
      if (!context.canReadFinancial) return base;
      const commitments = await prisma.commitment.findMany({
        where: { startupId, startupInvestorId: input.investorId },
        select: { amount: true, status: true, expectedCloseDate: true },
      });
      return { ...base, commitments: commitments.map((commitment) => ({ amount: commitment.amount === null ? null : Number(commitment.amount), status: commitment.status, expectedCloseDate: commitment.expectedCloseDate })) };
    }
    if (tool === "get_reviewer_engagement") {
      const versions = await prisma.documentVersion.findMany({ where: { document: { startupId, ...(input.documentId ? { id: input.documentId } : {}) } }, take: 10, select: { id: true, document: { select: { id: true, title: true } } } });
      const counts = await prisma.reviewerInvitationDocument.groupBy({ by: ["documentVersionId"], where: { documentVersionId: { in: versions.map((version) => version.id) } }, _count: { invitationId: true } });
      const countByVersion = new Map(counts.map((count) => [count.documentVersionId, count._count.invitationId]));
      return versions.map((version) => ({ id: version.document.id, title: version.document.title, invitationCount: countByVersion.get(version.id) ?? 0 }));
    }
    if (tool === "search_investors" || tool === "list_investors") {
      return investorService.listInvestors(startupId, {
        page: 1,
        limit: 10,
        ...(tool === "search_investors" ? { search: input.query } : {}),
        ...(tool === "list_investors" && input.roundId ? { roundId: input.roundId } : {}),
        ...(tool === "list_investors" && input.stage ? { stage: input.stage } : {}),
      });
    }
    if (tool === "get_pipeline_by_stage") return pipelineService.getByStage(startupId, input.roundId);
    if (tool === "get_interaction_history") return interactionLogService.listLogsByInvestor(startupId, input.investorId, { page: 1, limit: 15 });
    if (tool === "list_tasks") {
      return taskService.listTasks(startupId, {
        page: 1,
        limit: 25,
        ...(input.roundId && { roundId: input.roundId }),
        ...(input.status && { status: input.status }),
        ...(input.assigneeId && { assigneeId: input.assigneeId }),
      });
    }
    if (tool === "list_team_conversations" || tool === "search_team_messages") {
      // Chat access is scoped by the caller's own ConversationMember rows, not
      // by startupId alone chat:read grants the ability to read chat, not the
      // ability to read every conversation (that would leak DMs, including
      // ones about the caller). Resolved here, per call, from the
      // authenticated userId never from a model-supplied id.
      const memberId = await this.resolveMemberId(startupId, context.userId);
      if (tool === "list_team_conversations") return chatService.listConversations(startupId, memberId);
      return chatService.searchMessages(startupId, memberId, input.query);
    }

    // tool is one of the five propose_* write tools: this only ever creates a
    // "proposed" AiAgentAction row it never sends, schedules, or writes
    // anything. Even a successfully prompt-injected model can only get this
    // far, not further — a human still has to click Approve.
    const actionType = PROPOSE_TOOL_ACTION_TYPES[tool];
    if (!actionType) throw new Error("AI_TOOL_FORBIDDEN");
    if (!context.userId || !context.sessionId || !context.messageId) throw new Error("AI_TOOL_FORBIDDEN");
    const action = await aiActionsService.proposeAction(startupId, context.sessionId, context.messageId, context.userId, actionType, stripNulls(input));
    return {
      actionId: action.id,
      actionType: action.actionType,
      status: action.status,
      expiresAt: action.expiresAt,
      summary: "Drafted and awaiting the user's review in the card attached to this message. Do not say this was sent, created, scheduled, or logged — say it was drafted and is awaiting approval.",
    };
  }

  private async resolveMemberId(startupId: string, userId: string | undefined): Promise<string> {
    if (!userId) throw new Error("AI_TOOL_FORBIDDEN");
    const member = await prisma.startupMember.findUnique({ where: { startupId_userId: { startupId, userId } }, select: { id: true, status: true } });
    if (!member || member.status !== "active") throw new Error("AI_TOOL_FORBIDDEN");
    return member.id;
  }
}

export const aiToolsService = new AiToolsService();
