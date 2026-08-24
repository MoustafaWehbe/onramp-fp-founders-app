export type PipelineStageId =
  | "sourced"
  | "contacted"
  | "meeting_scheduled"
  | "due_diligence"
  | "term_sheet"
  | "committed"
  | "passed";

export type PipelineStage = {
  id: PipelineStageId;
  label: string;
  /** Badge fill + text colour, applied over the outline badge variant. */
  badgeClass: string;
  dotClass: string;
};

/** Matches packages/api/src/config/crm.ts PIPELINE_STAGES. */
export const STAGES: PipelineStage[] = [
  {
    id: "sourced",
    label: "Sourced",
    badgeClass: "bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
  {
    id: "contacted",
    label: "Contacted",
    badgeClass: "bg-info/15 text-info",
    dotClass: "bg-info",
  },
  {
    id: "meeting_scheduled",
    label: "Meeting",
    badgeClass: "bg-warning/15 text-warning",
    dotClass: "bg-warning",
  },
  {
    // Distinct from "meeting" (amber) and "term sheet" (rose) below these
    // two used to both be plain "primary" orange and were nearly
    // indistinguishable as small dots next to meeting's amber.
    id: "due_diligence",
    label: "Diligence",
    badgeClass: "bg-chart-5/15 text-chart-5",
    dotClass: "bg-chart-5",
  },
  {
    id: "term_sheet",
    label: "Term sheet",
    badgeClass: "bg-chart-6/15 text-chart-6",
    dotClass: "bg-chart-6",
  },
  {
    id: "committed",
    label: "Committed",
    badgeClass: "bg-success/15 text-success",
    dotClass: "bg-success",
  },
  {
    id: "passed",
    label: "Passed",
    badgeClass: "bg-destructive/15 text-destructive",
    dotClass: "bg-destructive",
  },
];

export const DEFAULT_PROBABILITY_BY_STAGE: Record<PipelineStageId, number> = {
  sourced: 10,
  contacted: 25,
  meeting_scheduled: 45,
  due_diligence: 70,
  term_sheet: 80,
  committed: 90,
  passed: 0,
};

const stagesById = new Map(STAGES.map((stage) => [stage.id, stage]));

export function getStage(id: PipelineStageId): PipelineStage {
  return stagesById.get(id) ?? STAGES[0];
}
