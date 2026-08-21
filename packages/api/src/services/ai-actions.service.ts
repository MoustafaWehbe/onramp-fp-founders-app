import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { hasPermission } from "../middleware/rbac";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit-writer";
import { AI_ACTION_PAYLOAD_SCHEMAS, AI_ACTION_PERMISSIONS, type AiActionType } from "../validators/ai-action.schemas";
import { taskService } from "./task.service";
import { interactionLogService } from "./interaction-log.service";
import { calendarEventService } from "./calendar-event.service";
import { gmailSendService } from "./gmail-send.service";
import { pipelineService } from "./pipeline.service";

const EXPIRY_MS = 24 * 60 * 60 * 1000;

export class AiActionsService {
  /**
   * The model only ever reaches this method it never calls a send/schedule/
   * write service directly. Creating a row here proposes a write; it never
   * performs one. That split is what keeps a prompt-injected instruction
   * ("email everyone that the round is closing") from ever becoming an
   * outbound action a human still has to click Send.
   */
  async proposeAction(startupId: string, sessionId: string, messageId: string, userId: string, actionType: AiActionType, rawPayload: unknown) {
    const schema = AI_ACTION_PAYLOAD_SCHEMAS[actionType];
    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) throw createError(`Invalid ${actionType} payload: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`, 400, "AI_ACTION_INVALID_PAYLOAD");

    // Fails fast on an obviously-wrong target before ever writing a proposal
    // row. Full re-validation against live data (not this snapshot) happens
    // again at approve time regardless.
    await this.verifyTargetsBelongToStartup(startupId, parsed.data as Record<string, unknown>);

    return prisma.aiAgentAction.create({
      data: {
        startupId,
        sessionId,
        messageId,
        userId,
        actionType,
        payload: parsed.data as object,
        expiresAt: new Date(Date.now() + EXPIRY_MS),
      },
    });
  }

  /**
   * The one place a proposal turns into a real write always delegates to the
   * exact same service the manual UI button uses, so the AI path can never be
   * weaker than clicking the button by hand. Re-checks the caller's live
   * permission (a role downgraded between propose and click must fail closed)
   * and claims the row atomically so a double-click sends one email, not two.
   */
  async approveAction(startupId: string, userId: string, roleId: string, actionId: string, payloadOverride?: Record<string, unknown>) {
    const action = await prisma.aiAgentAction.findFirst({ where: { id: actionId, startupId } });
    if (!action) throw createError("Action not found", 404, "AI_ACTION_NOT_FOUND");
    if (action.status === "executed") return { action, result: action.resultRef };
    if (action.status !== "proposed") throw createError(`This proposal is already ${action.status}`, 409, "AI_ACTION_NOT_PENDING");

    if (action.expiresAt.getTime() < Date.now()) {
      await prisma.aiAgentAction.updateMany({ where: { id: action.id, status: "proposed" }, data: { status: "expired" } });
      throw createError("This proposal has expired — ask the copilot to draft it again", 410, "AI_ACTION_EXPIRED");
    }

    const permission = AI_ACTION_PERMISSIONS[action.actionType as AiActionType];
    if (!(await hasPermission(roleId, permission.resource, permission.action))) {
      throw createError("Forbidden", 403, "FORBIDDEN");
    }

    const schema = AI_ACTION_PAYLOAD_SCHEMAS[action.actionType as AiActionType];
    const merged = { ...(action.payload as object), ...(payloadOverride ?? {}) };
    const parsed = schema.safeParse(merged);
    if (!parsed.success) throw createError(`Invalid ${action.actionType} payload: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`, 400, "AI_ACTION_INVALID_PAYLOAD");
    const resolvedPayload = parsed.data as Record<string, unknown>;
    await this.verifyTargetsBelongToStartup(startupId, resolvedPayload);

    const claimed = await prisma.aiAgentAction.updateMany({ where: { id: action.id, status: "proposed" }, data: { status: "approved", approvedAt: new Date(), resolvedPayload: resolvedPayload as object } });
    if (claimed.count === 0) {
      // Lost the race to a concurrent approve (or it just expired) replay
      // idempotently rather than erroring a second click that was really a retry.
      const latest = await prisma.aiAgentAction.findUniqueOrThrow({ where: { id: action.id } });
      if (latest.status === "executed") return { action: latest, result: latest.resultRef };
      throw createError(`This proposal is already ${latest.status}`, 409, "AI_ACTION_NOT_PENDING");
    }

    try {
      const resultRef = await this.execute(startupId, userId, action.actionType as AiActionType, resolvedPayload);
      const executed = await prisma.aiAgentAction.update({ where: { id: action.id }, data: { status: "executed", executedAt: new Date(), resultRef: resultRef as object } });
      await recordAuditEvent({ startupId, userId, action: AUDIT_ACTIONS.CREATE, entityType: `ai_action:${action.actionType}`, entityId: action.id, changes: { resultRef } });
      return { action: executed, result: resultRef };
    } catch (error: any) {
      const errorCode = typeof error?.code === "string" ? error.code : "AI_ACTION_EXECUTION_FAILED";
      await prisma.aiAgentAction.update({ where: { id: action.id }, data: { status: "failed", errorCode } });
      throw error;
    }
  }

  async rejectAction(startupId: string, actionId: string) {
    const action = await prisma.aiAgentAction.findFirst({ where: { id: actionId, startupId } });
    if (!action) throw createError("Action not found", 404, "AI_ACTION_NOT_FOUND");
    if (action.status !== "proposed") throw createError(`This proposal is already ${action.status}`, 409, "AI_ACTION_NOT_PENDING");
    return prisma.aiAgentAction.update({ where: { id: action.id }, data: { status: "rejected" } });
  }

  private async verifyTargetsBelongToStartup(startupId: string, payload: Record<string, unknown>): Promise<void> {
    if (typeof payload.investorId === "string") {
      const investor = await prisma.startupInvestor.findUnique({ where: { startupId_id: { startupId, id: payload.investorId } }, select: { id: true } });
      if (!investor) throw createError("Investor not found", 404, "INVESTOR_NOT_FOUND");
    }
    if (typeof payload.pipelineId === "string") {
      const pipeline = await prisma.pipeline.findUnique({ where: { startupId_id: { startupId, id: payload.pipelineId } }, select: { id: true } });
      if (!pipeline) throw createError("Pipeline entry not found", 404, "PIPELINE_NOT_FOUND");
    }
    if (typeof payload.taskId === "string") {
      const task = await prisma.task.findUnique({ where: { startupId_id: { startupId, id: payload.taskId } }, select: { id: true } });
      if (!task) throw createError("Task not found", 404, "TASK_NOT_FOUND");
    }
  }

  private async execute(startupId: string, userId: string, actionType: AiActionType, payload: Record<string, unknown>): Promise<object> {
    if (actionType === "create_task") {
      const result = await taskService.createTask(startupId, payload as any, userId);
      return { taskId: result.data.id };
    }
    if (actionType === "update_task_status") {
      const { taskId, status } = payload;
      const result = await taskService.updateTask(startupId, taskId as string, { status } as any, userId);
      return { taskId: result.data.id, status: result.data.status };
    }
    if (actionType === "log_interaction") {
      const result = await interactionLogService.createLog(startupId, payload as any, userId);
      return { logId: result.data.id };
    }
    if (actionType === "schedule_meeting") {
      const { investorId, ...input } = payload;
      const result = await calendarEventService.scheduleMeeting(startupId, investorId as string, userId, input as any);
      return { eventId: result.eventId, htmlLink: result.htmlLink };
    }
    if (actionType === "send_investor_email") {
      const { investorId, ...input } = payload;
      const result = await gmailSendService.sendInvestorEmail(startupId, investorId as string, userId, input as any);
      return { gmailMessageId: result.messageId, gmailThreadId: result.threadId };
    }
    // actionType === "update_deal_stage"
    const { pipelineId, toStage, ...rest } = payload;
    const entry = await pipelineService.updateEntry(startupId, pipelineId as string, { stage: toStage, ...rest } as any, userId);
    return { pipelineId: entry.id, stage: entry.stage };
  }
}

export const aiActionsService = new AiActionsService();
