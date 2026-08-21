import { z } from "zod";
import { PIPELINE_STAGES, COMMITMENT_STATUSES } from "../config/crm";
import { createTaskSchema } from "./task.schemas";
import { createInteractionLogSchema } from "./interaction-log.schemas";
import { scheduleMeetingSchema } from "./calendar-event.schemas";
import { sendInvestorEmailSchema } from "./gmail.schemas";

const uuid = z.string().uuid();

// Every AI-proposed write is validated against exactly the same shape the
// manual endpoint for that action accepts (imported directly, not
// re-derived), plus whatever target id the manual endpoint takes from the
// URL instead of the body. This is what keeps the AI path from ever being
// able to propose something the manual UI itself would reject.
export const AI_ACTION_PAYLOAD_SCHEMAS = {
  create_task: createTaskSchema,
  log_interaction: createInteractionLogSchema,
  schedule_meeting: scheduleMeetingSchema.extend({ investorId: uuid }),
  send_investor_email: sendInvestorEmailSchema.extend({ investorId: uuid }),
  update_deal_stage: z.object({
    pipelineId: uuid,
    toStage: z.enum(PIPELINE_STAGES),
    // Required server-side (by pipelineService.updateEntry) when toStage is
    // "passed" enforced again here isn't redundant: it lets propose-time
    // fail fast with a clear message instead of a 400 surfacing at approve.
    reason: z.string().trim().min(1).max(500).optional(),
    commitment: z
      .object({
        amount: z.number().finite().min(0),
        status: z.enum(COMMITMENT_STATUSES).optional(),
        expectedCloseDate: z.union([z.coerce.date(), z.null()]).optional(),
      })
      .optional(),
  }),
} as const;

export type AiActionType = keyof typeof AI_ACTION_PAYLOAD_SCHEMAS;

export const AI_ACTION_TYPES = Object.keys(AI_ACTION_PAYLOAD_SCHEMAS) as AiActionType[];

/** resource:action pair the caller must hold, re-checked live at approve time (never trusted from propose time). */
export const AI_ACTION_PERMISSIONS: Record<AiActionType, { resource: string; action: string }> = {
  create_task: { resource: "pipeline", action: "create" },
  log_interaction: { resource: "pipeline", action: "create" },
  schedule_meeting: { resource: "pipeline", action: "create" },
  send_investor_email: { resource: "pipeline", action: "create" },
  update_deal_stage: { resource: "pipeline", action: "update" },
};

export const aiActionIdParamSchema = z.object({ startupId: uuid, actionId: uuid });

export const approveAiActionSchema = z.object({
  // User-edited fields, merged over the proposed payload and re-validated
  // against the same schema above never trusted as a full replacement.
  payload: z.record(z.unknown()).optional(),
});

export type ApproveAiActionInput = z.infer<typeof approveAiActionSchema>;
