import { AI_ARTIFACT_REGISTRY } from "../../src/services/ai-artifact.service";
import { AI_ACTION_TYPES } from "../../src/validators/ai-action.schemas";

describe("action_proposal.v1 schema", () => {
  // Regression guard for a real bug: update_task_status was added as a 6th
  // AiActionType (validator, permissions, executor, tool) but this artifact's
  // own actionType enum was never updated to match, so every proposal of that
  // type failed AI_INVALID_ARTIFACT inside createReady — silently swallowed by
  // executeToolCall's nested try/catch, so the card just never appeared and
  // there was nothing for the user to click Approve on. Every action type the
  // system can propose must be representable in the card that shows it.
  it("accepts every AiActionType the propose/approve flow can produce, not just the original set", () => {
    const schema = AI_ARTIFACT_REGISTRY["action_proposal.v1"].schema;
    for (const actionType of AI_ACTION_TYPES) {
      const result = schema.safeParse({
        actionId: "00000000-0000-0000-0000-000000000001",
        actionType,
        status: "proposed",
        payload: {},
        expiresAt: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("daily_briefing.v1 schema", () => {
  it("accepts a compact briefing that owns the repeated list data", () => {
    const result = AI_ARTIFACT_REGISTRY["daily_briefing.v1"].schema.safeParse({
      generatedAt: "2026-08-23T08:00:00.000Z",
      assignedInvestorCount: 2,
      focusDeals: [{ investorId: "inv-1", investorName: "Ana Ruiz", stage: "meeting_scheduled", reason: "today", daysQuiet: 2, nextTaskDueDate: null }],
      overdueTasks: [],
      dueTodayTasks: [{ id: "task-1", title: "Send deck", investorName: "Ana Ruiz", priority: "high", dueDate: "2026-08-23T12:00:00.000Z" }],
      meetings: [{ id: "meeting-1", type: "meeting", subject: "Intro", interactionDate: "2026-08-23T15:00:00.000Z", investorName: "Ana Ruiz" }],
      roundHealth: { roundName: "Seed", currency: "USD", percentToTarget: 40, bankableRaised: 400000, remainingGap: 600000, daysToClose: 30 },
    });
    expect(result.success).toBe(true);
  });
});
