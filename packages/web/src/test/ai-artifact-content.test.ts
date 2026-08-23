import { describe, expect, it } from "vitest";
import { splitArtifactBackedContent } from "../pages/dashboard/Ai/artifact-content";

describe("artifact-backed AI message layout", () => {
  it("uses a compact artifact-aware introduction and keeps additive guidance", () => {
    expect(splitArtifactBackedContent("Sarah Chen is in due diligence at Sequoia Capital.\n\nStart with the overdue follow-up before the meeting.", [{
      type: "investor_brief.v1",
      data: { fullName: "Sarah Chen", ventureFirm: "Sequoia Capital", stage: "due_diligence" },
    }])).toEqual({
      intro: "Here’s the investor context.",
      followup: "Start with the overdue follow-up before the meeting.",
    });
  });

  it("removes factual prose that repeats multiple artifact values", () => {
    expect(splitArtifactBackedContent("Sarah Chen from Sequoia Capital is in due diligence.\n\nPrioritize communication with Sarah Chen today.", [{
      type: "investor_brief.v1",
      data: { fullName: "Sarah Chen", ventureFirm: "Sequoia Capital", stage: "due_diligence" },
    }])).toEqual({
      intro: "Here’s the investor context.",
      followup: "Prioritize communication with Sarah Chen today.",
    });
  });

  it("does not repeat a one-line factual answer above an artifact", () => {
    expect(splitArtifactBackedContent("Sarah Chen is the highest-priority investor.", [{ type: "focus_list.v1", data: { investorName: "Sarah Chen" } }])).toEqual({
      intro: "Here are the investors to prioritize.",
      followup: "",
    });
  });

  it("uses one combined introduction when investor and task cards appear together", () => {
    expect(splitArtifactBackedContent("Sarah Chen has an overdue task.", [
      { type: "investor_brief.v1", data: { fullName: "Sarah Chen" } },
      { type: "task_list.v1", data: { tasks: [{ title: "Send references" }] } },
    ])).toEqual({ intro: "Here’s the priority investor and related work.", followup: "" });
  });
});
