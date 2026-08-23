import { describe, expect, it } from "vitest";
import { splitArtifactBackedContent } from "../pages/dashboard/Ai/artifact-content";

describe("artifact-backed AI message layout", () => {
  it("places the first short paragraph above the artifact and interpretation below it", () => {
    expect(splitArtifactBackedContent("Here is today's briefing.\n\nStart with the overdue follow-up before the meeting.")).toEqual({
      intro: "Here is today's briefing.",
      followup: "Start with the overdue follow-up before the meeting.",
    });
  });

  it("keeps a one-line response entirely above the artifact", () => {
    expect(splitArtifactBackedContent("Here are the investors that need attention.")).toEqual({
      intro: "Here are the investors that need attention.",
      followup: "",
    });
  });
});
