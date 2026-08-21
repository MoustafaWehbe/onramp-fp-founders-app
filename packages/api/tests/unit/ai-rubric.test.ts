import { PITCH_DECK_RUBRIC_VERSION, pitchDeckAnalysisSchema } from "../../src/config/ai-rubric";

const CHUNK_ID = "00000000-0000-0000-0000-000000000001";

function validAnalysis() {
  return {
    schemaVersion: PITCH_DECK_RUBRIC_VERSION,
    executiveSummary: "The deck presents a clear problem and early customer evidence.",
    scores: { overall: 75, narrative: 80, marketValidation: 70, financial: 75, confidence: 82 },
    strengths: [{
      statement: "The problem is tied to a measurable customer workflow.",
      evidence: [{ documentChunkId: CHUNK_ID, label: "Problem", excerpt: "Teams spend eight hours each week reconciling invoices." }],
    }],
    gaps: [{
      section: "financials",
      status: "missing",
      issue: "The deck does not include a cash runway or unit economics forecast.",
      severity: "high",
      recommendation: "Add a 24-month forecast with assumptions and sensitivity ranges.",
      evidence: [],
    }],
    personas: [{
      name: "Seed SaaS investor",
      investmentLens: "Looks for retention evidence and efficient growth.",
      whyTheyCare: "The workflow targets a recurring finance pain point.",
      likelyObjections: ["The retention cohort is not shown."],
      questions: ["What does retention look like after six months?"],
    }],
  };
}

describe("pitch-deck analysis rubric", () => {
  it("accepts a versioned result and allows evidence-free missing findings", () => {
    expect(pitchDeckAnalysisSchema.parse(validAnalysis()).scores.overall).toBe(75);
  });

  it("rejects unsupported non-missing findings", () => {
    const result = validAnalysis();
    result.gaps[0].status = "partial";
    expect(() => pitchDeckAnalysisSchema.parse(result)).toThrow("require supporting document evidence");
  });

  it("rejects an overall score that does not follow the rubric weighting", () => {
    const result = validAnalysis();
    result.scores.overall = 20;
    expect(() => pitchDeckAnalysisSchema.parse(result)).toThrow("Overall score must match");
  });
});
