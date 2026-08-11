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
    // Distinct from "meeting" (amber) and "term sheet" (rose) below — these
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

export type Investor = {
  id: string;
  name: string;
  email: string;
  firm: string;
  sector: string;
  /** Cheque stage the investor typically writes at, e.g. "Seed". */
  stagePreference: string;
  /** Where the relationship currently sits in your pipeline. */
  pipelineStageId: PipelineStageId;
  amount: number;
  lastContact: string;
};

export const investors: Investor[] = [
  {
    id: "i1",
    name: "Amara Chen",
    email: "amara@atlasvc.com",
    firm: "Atlas Ventures",
    sector: "AI / Infrastructure",
    stagePreference: "Seed",
    pipelineStageId: "committed",
    amount: 250000,
    lastContact: "2 days ago",
  },
  {
    id: "i2",
    name: "Daniel Okafor",
    email: "d.okafor@northwind.capital",
    firm: "Northwind Capital",
    sector: "B2B SaaS",
    stagePreference: "Seed / Series A",
    pipelineStageId: "due_diligence",
    amount: 400000,
    lastContact: "4 days ago",
  },
  {
    id: "i3",
    name: "Priya Raman",
    email: "priya@seedline.partners",
    firm: "Seedline Partners",
    sector: "Fintech",
    stagePreference: "Pre-seed",
    pipelineStageId: "committed",
    amount: 150000,
    lastContact: "1 week ago",
  },
  {
    id: "i4",
    name: "Marcus Feld",
    email: "marcus@brightpath.vc",
    firm: "Brightpath VC",
    sector: "Developer tools",
    stagePreference: "Seed",
    pipelineStageId: "meeting_scheduled",
    amount: 300000,
    lastContact: "Yesterday",
  },
  {
    id: "i5",
    name: "Sofia Marino",
    email: "sofia@harborangels.com",
    firm: "Harbor Angels",
    sector: "Marketplaces",
    stagePreference: "Angel",
    pipelineStageId: "contacted",
    amount: 75000,
    lastContact: "3 days ago",
  },
  {
    id: "i6",
    name: "Ethan Brooks",
    email: "ethan@quantleap.fund",
    firm: "Quantleap Fund",
    sector: "AI / Infrastructure",
    stagePreference: "Series A",
    pipelineStageId: "meeting_scheduled",
    amount: 500000,
    lastContact: "5 days ago",
  },
  {
    id: "i7",
    name: "Lena Novak",
    email: "lena@meridian.partners",
    firm: "Meridian Partners",
    sector: "Healthtech",
    stagePreference: "Seed",
    pipelineStageId: "sourced",
    amount: 200000,
    lastContact: "2 weeks ago",
  },
  {
    id: "i8",
    name: "Tomas Alvarez",
    email: "tomas@cascade.ventures",
    firm: "Cascade Ventures",
    sector: "B2B SaaS",
    stagePreference: "Pre-seed / Seed",
    pipelineStageId: "due_diligence",
    amount: 125000,
    lastContact: "6 days ago",
  },
  {
    id: "i9",
    name: "Grace Lin",
    email: "grace@vertexcollective.com",
    firm: "Vertex Collective",
    sector: "Fintech",
    stagePreference: "Seed",
    pipelineStageId: "contacted",
    amount: 180000,
    lastContact: "9 days ago",
  },
  {
    id: "i10",
    name: "Owen Wright",
    email: "owen@lodestar.vc",
    firm: "Lodestar VC",
    sector: "Climate",
    stagePreference: "Series A",
    pipelineStageId: "sourced",
    amount: 350000,
    lastContact: "3 weeks ago",
  },
];

export type PipelineDeal = {
  id: string;
  investorId: Investor["id"];
  stageId: PipelineStageId;
  expectedAmount: number;
  probabilityPercentage: number;
};

export const pipelineDeals: PipelineDeal[] = investors.map((investor, index) => ({
  id: `deal-${index + 1}`,
  investorId: investor.id,
  stageId: investor.pipelineStageId,
  expectedAmount: investor.amount,
  probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE[investor.pipelineStageId],
}));

export type RoundStatus = "active" | "closed" | "planned";

export type Round = {
  id: string;
  name: string;
  status: RoundStatus;
  raised: number;
  target: number;
  ticket: number;
  equity: number;
  currency: string;
};

export const rounds: Round[] = [
  {
    id: "r1",
    name: "Pre-Seed",
    status: "closed",
    raised: 500_000,
    target: 500_000,
    ticket: 25_000,
    equity: 8,
    currency: "USD",
  },
  {
    id: "r2",
    name: "Seed",
    status: "active",
    raised: 1_250_000,
    target: 2_500_000,
    ticket: 100_000,
    equity: 15,
    currency: "USD",
  },
  {
    id: "r3",
    name: "Series A",
    status: "planned",
    raised: 0,
    target: 8_000_000,
    ticket: 500_000,
    equity: 18,
    currency: "USD",
  },
];

export type NotificationType = "ai" | "reviewer" | "commitment" | "task" | "team";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  when: string;
  read: boolean;
};

export const notifications: Notification[] = [
  {
    id: "n1",
    type: "ai",
    title: "AI analysis ready",
    body: "Market fit gap analysis finished for Lumen AI. Three risks flagged in the go-to-market section.",
    when: "12m ago",
    read: false,
  },
  {
    id: "n2",
    type: "commitment",
    title: "New commitment logged",
    body: "Atlas Ventures soft-committed $250k to your Seed round.",
    when: "1h ago",
    read: false,
  },
  {
    id: "n3",
    type: "reviewer",
    title: "Reviewer left feedback",
    body: "Priya Raman commented on Investor Deck - Series A, page 7.",
    when: "3h ago",
    read: false,
  },
  {
    id: "n4",
    type: "task",
    title: "Follow-up due today",
    body: "You planned to send the updated metrics sheet to Northwind Capital.",
    when: "5h ago",
    read: false,
  },
  {
    id: "n5",
    type: "team",
    title: "Teammate joined",
    body: "Daniel Okafor accepted your invite and joined as a Member.",
    when: "Yesterday",
    read: true,
  },
  {
    id: "n6",
    type: "commitment",
    title: "Wire received",
    body: "$150k from Seedline Partners cleared and was added to your raised total.",
    when: "2 days ago",
    read: true,
  },
  {
    id: "n7",
    type: "ai",
    title: "Investor match suggestions",
    body: "Seven new investors match your stage, sector, and check size.",
    when: "3 days ago",
    read: true,
  },
];