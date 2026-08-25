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
