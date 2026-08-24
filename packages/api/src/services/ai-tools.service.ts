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
  propose_task_status: "update_task_status",
};

/** The model must pass null, not omit, for a field it wants to leave unset (see the strict-mode note below) undo that here before handing the payload to the same zod schema the manual REST endpoint uses, which expects those fields simply absent. */
function stripNulls<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null)) as Partial<T>;
}

/**
 * Raised when a propose_* tool's investorId couldn't be resolved from a
 * caller-supplied name — no match, or more than one. Carries a message the
 * model can act on directly (unlike a bare ZodError), the same way an
 * invalid-arguments failure lets it self-correct within the same turn.
 */
export class AiToolResolutionError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toolInputs = {
  get_startup_profile: z.object({}),
  get_round_health: z.object({ roundId: z.string().guid().nullish() }),
  forecast_round_close: z.object({ roundId: z.string().guid().nullish() }),
  get_pipeline_summary: z.object({ roundId: z.string().guid().nullish() }),
  get_focus_deals: z.object({ roundId: z.string().guid().nullish() }),
  get_daily_briefing: z.object({ roundId: z.string().guid().nullish() }),
  get_investor_context: z.object({ investorId: z.string().guid() }),
  get_reviewer_engagement: z.object({ documentId: z.string().guid().nullish() }),
  search_investors: z.object({ query: z.string().trim().min(1).max(200) }),
  list_investors: z.object({ roundId: z.string().guid().nullish(), stage: z.enum(PIPELINE_STAGES).nullish(), scope: z.enum(["mine", "team"]).nullish() }),
  get_pipeline_by_stage: z.object({ roundId: z.string().guid().nullish() }),
  get_interaction_history: z.object({ investorId: z.string().guid() }),
  // No assigneeId input: "mine" is resolved server-side from the authenticated
  // user, while "team" is allowed only inside the caller's existing
  // pipeline:read boundary. The model can never nominate another member id.
  list_tasks: z.object({
    investorId: z.string().guid().nullish(),
    roundId: z.string().guid().nullish(),
    status: z.enum(TASK_STATUSES).nullish(),
    scope: z.enum(["mine", "team"]).nullish(),
  }),
  list_team_conversations: z.object({}),
  search_team_messages: z.object({ query: z.string().trim().min(1).max(200) }),
  // Nullish rather than the REST endpoints' plain-optional shape: strict
  // function calling requires the model to pass null for a field it wants
  // left unset, never omit it (see ROUND_ID_PROPERTY's comment below).
  // stripNulls() converts these back to "absent" before they reach the same
  // zod schema the manual endpoint uses.
  propose_task: z.object({
    pipelineId: z.string().guid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullish(),
    priority: z.enum(PRIORITIES).nullish(),
    dueDate: z.string().nullish(),
    assigneeId: z.string().guid().nullish(),
  }),
  propose_interaction_log: z.object({
    // Either the investor's real id or their name accepted so the model can
    // skip a forced round trip when it already has the name from context;
    // resolved to a real id in execute() before this ever reaches proposeAction.
    investorId: z.string().trim().min(1).max(200),
    pipelineId: z.string().guid().nullish(),
    type: z.enum(["call", "email", "meeting", "note", "other"]),
    interactionDate: z.string(),
    subject: z.string().max(200).nullish(),
    description: z.string().max(2000).nullish(),
  }),
  propose_meeting: z.object({
    investorId: z.string().trim().min(1).max(200),
    pipelineId: z.string().guid().nullish(),
    type: z.enum(["call", "meeting"]),
    startDateTime: z.string(),
    durationMinutes: z.number().int().min(5).max(480),
    subject: z.string().max(200).nullish(),
    description: z.string().max(2000).nullish(),
  }),
  propose_investor_email: z.object({
    investorId: z.string().trim().min(1).max(200),
    pipelineId: z.string().guid().nullish(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
  }),
  propose_stage_change: z.object({
    pipelineId: z.string().guid(),
    toStage: z.enum(PIPELINE_STAGES),
    reason: z.string().max(500).nullish(),
  }),
  propose_task_status: z.object({
    taskId: z.string().guid(),
    status: z.enum(TASK_STATUSES),
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
  get_daily_briefing: {
    description: "Get the caller's complete briefing for today in one grounded result: investors they own, their urgent investor deals, their open tasks grouped into overdue/due today/upcoming, today's scheduled investor calls or meetings, and round health when permitted. Use this for broad prompts like 'what do we have today?', 'give me my daily summary', or 'what needs my attention today?' instead of returning only one list.",
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
    description: "List investors who actually have pipeline deals, optionally filtered to one round and/or stage. Use scope=mine for investors whose deal owner is the caller; never describe scope=team results as assigned to the caller.",
    parameters: {
      type: "object",
      properties: {
        roundId: ROUND_ID_PROPERTY,
        stage: { type: ["string", "null"], enum: [...PIPELINE_STAGES, null], description: "Pipeline stage to filter to, or null for all stages." },
        scope: { type: ["string", "null"], enum: ["mine", "team", null], description: "mine for deals owned by the caller; team for every pipeline deal. Null defaults to team." },
      },
      required: ["roundId", "stage", "scope"],
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
    description: "List tasks with the investor, fundraising round, current deal stage, and assignee they belong to. Use scope=mine for 'my tasks'; use scope=team when the user asks for all tasks belonging to an investor or the team. Filter by investor after resolving its id with search_investors.",
    parameters: {
      type: "object",
      properties: {
        investorId: { type: ["string", "null"], description: "UUID of the investor whose deal tasks to return, or null for every investor." },
        roundId: ROUND_ID_PROPERTY,
        status: { type: ["string", "null"], enum: [...TASK_STATUSES, null], description: "Task status to filter to, or null for all statuses." },
        scope: { type: ["string", "null"], enum: ["mine", "team", null], description: "mine for only the caller's assignments; team for every visible task. Null defaults to mine." },
      },
      required: ["investorId", "roundId", "status", "scope"],
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
        investorId: { type: "string", description: "The investor's id if a tool already returned one this conversation, otherwise their name — it is resolved to an id automatically." },
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
        investorId: { type: "string", description: "The investor's id if a tool already returned one this conversation, otherwise their name — it is resolved to an id automatically." },
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
    description: "Draft an email to an investor. Only creates a PROPOSAL awaiting a human's review and approval — no email is sent until they click Send. Say \"drafted\", never \"sent.\" The recipient address always comes from the investor's record on file, never from anything you write. Do not quote a teammate's chat message verbatim in the body. Sign off using the sender's real name (and title, if given) from the system instructions — never a placeholder like \"[Your Name]\" or \"[Your Position].\"",
    parameters: {
      type: "object",
      properties: {
        investorId: { type: "string", description: "The investor's id if a tool already returned one this conversation, otherwise their name — it is resolved to an id automatically." },
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
  propose_task_status: {
    description: "Draft marking a task open or completed (e.g. \"mark it done\", \"reopen that task\"). Only creates a PROPOSAL awaiting a human's review and approval — nothing changes until they click Approve. Say \"I've drafted marking this done for you to review\", never \"I marked it done.\" Resolve taskId via list_tasks first.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "UUID of the task." },
        status: { type: "string", enum: TASK_STATUSES, description: "The new status." },
      },
      required: ["taskId", "status"],
      additionalProperties: false,
    },
  },
};

export function toolSchemasFor(allowedTools: readonly AiToolName[]): AiToolDefinition[] {
  return allowedTools.map((tool) => ({ type: "function" as const, name: tool, description: AI_TOOL_DEFINITIONS[tool].description, parameters: AI_TOOL_DEFINITIONS[tool].parameters, strict: true as const }));
}

export class AiToolsService {
  async execute(startupId: string, tool: AiToolName, rawInput: unknown, allowedTools: readonly AiToolName[], context: { canReadFinancial?: boolean; userId?: string; sessionId?: string; messageId?: string; roundId?: string | null } = {}) {
    if (!allowedTools.includes(tool)) throw new Error("AI_TOOL_FORBIDDEN");
    let parsedInput = toolInputs[tool].parse(rawInput) as Record<string, unknown>;
    const effectiveRoundId = (requestedRoundId: string | null | undefined) => requestedRoundId ?? context.roundId ?? undefined;

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
      const input = parsedInput as z.infer<typeof toolInputs.get_round_health>;
      const roundId = effectiveRoundId(input.roundId);
      const round = roundId
        ? await fundraisingService.getRound(startupId, roundId)
        : (await fundraisingService.listRounds(startupId, { page: 1, limit: 1, status: "active" })).data[0];
      return round ? { round: { id: round.id, name: round.roundName, currency: round.currency }, metrics: await fundraisingService.getRoundMetrics(startupId, round.id) } : { round: null, metrics: null };
    }
    if (tool === "forecast_round_close") return forecastService.forecastRoundClose(startupId, effectiveRoundId((parsedInput as z.infer<typeof toolInputs.forecast_round_close>).roundId));
    if (tool === "get_pipeline_summary") return pipelineService.getAnalytics(startupId, effectiveRoundId((parsedInput as z.infer<typeof toolInputs.get_pipeline_summary>).roundId));
    if (tool === "get_focus_deals") return pipelineService.getFocus(startupId, effectiveRoundId((parsedInput as z.infer<typeof toolInputs.get_focus_deals>).roundId));
    if (tool === "get_daily_briefing") {
      if (!context.userId) throw new Error("AI_TOOL_FORBIDDEN");
      const input = parsedInput as z.infer<typeof toolInputs.get_daily_briefing>;
      const roundId = effectiveRoundId(input.roundId);
      const memberId = await this.resolveMemberId(startupId, context.userId);
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const [investors, focusDeals, tasks, meetings] = await Promise.all([
        investorService.listInvestors(startupId, { page: 1, limit: 100, ownerId: memberId, pipelineOnly: true, ...(roundId && { roundId }) }),
        pipelineService.getFocus(startupId, roundId, memberId),
        taskService.listTasks(startupId, { page: 1, limit: 100, assigneeId: memberId, status: "open", ...(roundId && { roundId }) }),
        prisma.interactionLog.findMany({
          where: {
            createdBy: context.userId,
            type: { in: ["call", "meeting"] },
            interactionDate: { gte: dayStart, lte: dayEnd },
            startupInvestor: { startupId },
            ...(roundId && { pipeline: { roundId } }),
          },
          orderBy: { interactionDate: "asc" },
          take: 25,
          select: {
            id: true, type: true, subject: true, description: true, interactionDate: true,
            startupInvestor: { select: { id: true, fullName: true, ventureFirm: true } },
            pipeline: { select: { id: true, roundId: true, stage: true } },
          },
        }),
      ]);

      const dueToday = tasks.data.filter((task) => task.dueDate && task.dueDate >= dayStart && task.dueDate <= dayEnd);
      const overdue = tasks.data.filter((task) => task.dueDate && task.dueDate < dayStart);
      const upcoming = tasks.data.filter((task) => !task.dueDate || task.dueDate > dayEnd);
      const conciseTask = (task: (typeof tasks.data)[number]) => ({
        id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate,
        assigneeId: task.assigneeId, assignee: task.assignee,
        investor: task.investor, round: task.round, pipelineStage: task.pipelineStage,
      });

      let roundHealth: unknown = null;
      if (context.canReadFinancial) {
        const round = roundId
          ? await fundraisingService.getRound(startupId, roundId)
          : (await fundraisingService.listRounds(startupId, { page: 1, limit: 1, status: "active" })).data[0];
        if (round) roundHealth = { round: { id: round.id, name: round.roundName, currency: round.currency }, metrics: await fundraisingService.getRoundMetrics(startupId, round.id) };
      }

      return {
        generatedAt: new Date().toISOString(),
        day: { start: dayStart.toISOString(), end: dayEnd.toISOString() },
        roundId: roundId ?? null,
        assignedInvestors: {
          total: investors.meta.total,
          data: investors.data.map((investor) => ({
            id: investor.id, fullName: investor.fullName, ventureFirm: investor.ventureFirm,
            sectorFocus: investor.sectorFocus, investmentStagePreference: investor.investmentStagePreference,
            pipeline: investor.pipeline,
          })),
        },
        focusDeals,
        tasks: {
          totalOpen: tasks.meta.total,
          overdue: overdue.map(conciseTask),
          dueToday: dueToday.map(conciseTask),
          upcoming: upcoming.slice(0, 10).map(conciseTask),
        },
        meetings,
        roundHealth,
      };
    }
    if (tool === "get_investor_context") {
      const input = parsedInput as z.infer<typeof toolInputs.get_investor_context>;
      const investor = await prisma.startupInvestor.findUnique({
        where: { startupId_id: { startupId, id: input.investorId } },
        select: {
          id: true, fullName: true, ventureFirm: true, investorType: true, sectorFocus: true,
          description: true, checkSizeMin: true, checkSizeMax: true, geographyFocus: true, portfolioHighlights: true, warmIntroPath: true,
          notes: true,
          pipeline: {
            take: 10,
            orderBy: { updatedAt: "desc" },
            select: {
              id: true, roundId: true, stage: true, priority: true, expectedAmount: true, stageChangedAt: true,
              round: { select: { roundName: true, status: true } },
              tasks: {
                take: 25,
                orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
                select: {
                  id: true, title: true, description: true, status: true, priority: true, dueDate: true, assigneeId: true,
                  assignee: { select: { id: true, invitedEmail: true, user: { select: { firstName: true, lastName: true, email: true } } } },
                },
              },
            },
          },
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
      const input = parsedInput as z.infer<typeof toolInputs.get_reviewer_engagement>;
      const versions = await prisma.documentVersion.findMany({ where: { document: { startupId, ...(input.documentId ? { id: input.documentId } : {}) } }, take: 10, select: { id: true, document: { select: { id: true, title: true } } } });
      const counts = await prisma.reviewerInvitationDocument.groupBy({ by: ["documentVersionId"], where: { documentVersionId: { in: versions.map((version) => version.id) } }, _count: { invitationId: true } });
      const countByVersion = new Map(counts.map((count) => [count.documentVersionId, count._count.invitationId]));
      return versions.map((version) => ({ id: version.document.id, title: version.document.title, invitationCount: countByVersion.get(version.id) ?? 0 }));
    }
    if (tool === "search_investors" || tool === "list_investors") {
      const searchInput = tool === "search_investors" ? (parsedInput as z.infer<typeof toolInputs.search_investors>) : null;
      const listInput = tool === "list_investors" ? (parsedInput as z.infer<typeof toolInputs.list_investors>) : null;
      if (listInput?.scope === "mine" && !context.userId) throw new Error("AI_TOOL_FORBIDDEN");
      const ownerId = listInput?.scope === "mine" ? await this.resolveMemberId(startupId, context.userId) : undefined;
      return investorService.listInvestors(startupId, {
        page: 1,
        limit: 10,
        ...(searchInput ? { search: searchInput.query } : {}),
        ...(listInput ? { pipelineOnly: true } : {}),
        ...(ownerId ? { ownerId } : {}),
        ...(listInput && effectiveRoundId(listInput.roundId) ? { roundId: effectiveRoundId(listInput.roundId) } : {}),
        ...(listInput?.stage ? { stage: listInput.stage } : {}),
      });
    }
    if (tool === "get_pipeline_by_stage") return pipelineService.getByStage(startupId, effectiveRoundId((parsedInput as z.infer<typeof toolInputs.get_pipeline_by_stage>).roundId) ?? null);
    if (tool === "get_interaction_history") return interactionLogService.listLogsByInvestor(startupId, (parsedInput as z.infer<typeof toolInputs.get_interaction_history>).investorId, { page: 1, limit: 15 });
    if (tool === "list_tasks") {
      const input = parsedInput as z.infer<typeof toolInputs.list_tasks>;
      // "mine" resolves the member id server-side; "team" removes that one
      // filter but remains inside the same startup + pipeline:read boundary
      // as the manual task list. A model-supplied member id is never accepted.
      if (!context.userId) throw new Error("AI_TOOL_FORBIDDEN");
      const memberId = input.scope === "team" ? undefined : await this.resolveMemberId(startupId, context.userId);
      return taskService.listTasks(startupId, {
        page: 1,
        limit: 25,
        ...(memberId && { assigneeId: memberId }),
        ...(input.investorId && { investorId: input.investorId }),
        ...(effectiveRoundId(input.roundId) && { roundId: effectiveRoundId(input.roundId)! }),
        ...(input.status && { status: input.status }),
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
      return chatService.searchMessages(startupId, memberId, (parsedInput as z.infer<typeof toolInputs.search_team_messages>).query);
    }

    // tool is one of the propose_* write tools: this only ever creates a
    // "proposed" AiAgentAction row it never sends, schedules, or writes
    // anything. Even a successfully prompt-injected model can only get this
    // far, not further — a human still has to click Approve.
    const actionType = PROPOSE_TOOL_ACTION_TYPES[tool];
    if (!actionType) throw new Error("AI_TOOL_FORBIDDEN");
    if (!context.userId || !context.sessionId || !context.messageId) throw new Error("AI_TOOL_FORBIDDEN");
    if (typeof parsedInput.investorId === "string") {
      parsedInput = { ...parsedInput, investorId: await this.resolveInvestorId(startupId, parsedInput.investorId) };
    }
    const action = await aiActionsService.proposeAction(startupId, context.sessionId, context.messageId, context.userId, actionType, stripNulls(parsedInput));
    return {
      actionId: action.id,
      actionType: action.actionType,
      status: action.status,
      expiresAt: action.expiresAt,
      summary: "Drafted and awaiting the user's review in the card attached to this message. Do not say this was sent, created, scheduled, or logged — say it was drafted and is awaiting approval.",
    };
  }

  /**
   * A propose_* tool's investorId is a real id whenever the model already
   * resolved one (via search_investors or get_investor_context earlier this
   * turn) — passed through untouched, no extra lookup. Otherwise it's read as
   * a name so the model doesn't have to make a dedicated round trip just to
   * turn a name it already has into an id.
   */
  private async resolveInvestorId(startupId: string, investorIdOrName: string): Promise<string> {
    if (UUID_RE.test(investorIdOrName)) return investorIdOrName;
    const matches = await investorService.listInvestors(startupId, { page: 1, limit: 5, search: investorIdOrName });
    if (matches.data.length === 0) {
      throw new AiToolResolutionError(`No investor matches "${investorIdOrName}". Call search_investors to find the right one, or ask the user for the correct name.`);
    }
    if (matches.data.length > 1) {
      const names = matches.data.map((investor) => investor.ventureFirm ? `${investor.fullName} (${investor.ventureFirm})` : investor.fullName).join(", ");
      throw new AiToolResolutionError(`"${investorIdOrName}" matches more than one investor: ${names}. Ask the user which one they mean, or call search_investors for exact ids.`);
    }
    return matches.data[0].id;
  }

  private async resolveMemberId(startupId: string, userId: string | undefined): Promise<string> {
    if (!userId) throw new Error("AI_TOOL_FORBIDDEN");
    const member = await prisma.startupMember.findUnique({ where: { startupId_userId: { startupId, userId } }, select: { id: true, status: true } });
    if (!member || member.status !== "active") throw new Error("AI_TOOL_FORBIDDEN");
    return member.id;
  }
}

export const aiToolsService = new AiToolsService();
