import { z } from "zod";

/**
 * The rubric is versioned so an analysis remains interpretable after the
 * scoring criteria evolve. Product approval is required before this version
 * is enabled for production analysis runs.
 */
export const PITCH_DECK_RUBRIC_VERSION = "pitch-deck.v1";

export const PITCH_DECK_SCORE_WEIGHTS = {
  narrative: 40,
  marketValidation: 35,
  financial: 25,
} as const;

export const PITCH_DECK_SECTIONS = [
  "problem",
  "solution",
  "target_customer",
  "market",
  "business_model",
  "traction",
  "go_to_market",
  "competition",
  "team",
  "financials",
  "funding_ask",
] as const;

const scoreSchema = z.number().int().min(0).max(100);
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const pitchDeckEvidenceSchema = z.object({
  documentChunkId: z.string().uuid(),
  label: boundedText(160),
  excerpt: boundedText(600),
});

export const pitchDeckGapSchema = z.object({
  section: z.enum(PITCH_DECK_SECTIONS),
  status: z.enum(["supported", "partial", "missing", "conflicting"]),
  issue: boundedText(1_000),
  severity: z.enum(["low", "medium", "high", "critical"]),
  recommendation: boundedText(1_000),
  // Missing-information findings are allowed to have no source evidence.
  evidence: z.array(pitchDeckEvidenceSchema).max(6),
});

export const pitchDeckPersonaSchema = z.object({
  name: boundedText(120),
  investmentLens: boundedText(500),
  whyTheyCare: boundedText(500),
  likelyObjections: z.array(boundedText(500)).min(1).max(6),
  questions: z.array(boundedText(500)).min(1).max(8),
});

export const pitchDeckAnalysisSchema = z.object({
  schemaVersion: z.literal(PITCH_DECK_RUBRIC_VERSION),
  executiveSummary: boundedText(3_000),
  scores: z.object({
    overall: scoreSchema,
    narrative: scoreSchema,
    marketValidation: scoreSchema,
    financial: scoreSchema,
    confidence: scoreSchema,
  }),
  strengths: z.array(z.object({
    statement: boundedText(800),
    evidence: z.array(pitchDeckEvidenceSchema).min(1).max(4),
  })).max(8),
  gaps: z.array(pitchDeckGapSchema).max(12),
  personas: z.array(pitchDeckPersonaSchema).max(4),
}).superRefine((analysis, context) => {
  const weightedScore = Math.round(
    (analysis.scores.narrative * PITCH_DECK_SCORE_WEIGHTS.narrative
      + analysis.scores.marketValidation * PITCH_DECK_SCORE_WEIGHTS.marketValidation
      + analysis.scores.financial * PITCH_DECK_SCORE_WEIGHTS.financial) / 100,
  );

  if (Math.abs(analysis.scores.overall - weightedScore) > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scores", "overall"],
      message: "Overall score must match the versioned weighted score within one point.",
    });
  }

  for (const [index, gap] of analysis.gaps.entries()) {
    if (gap.status !== "missing" && gap.evidence.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gaps", index, "evidence"],
        message: "Non-missing findings require supporting document evidence.",
      });
    }
  }
});

export type PitchDeckAnalysis = z.infer<typeof pitchDeckAnalysisSchema>;
