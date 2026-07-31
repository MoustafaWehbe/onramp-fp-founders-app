export type PipelineStageId =
  | "lead"
  | "contacted"
  | "meeting"
  | "diligence"
  | "committed"
  | "closed"
  | "passed";

export type PipelineStage = {
  id: PipelineStageId;
  label: string;
  /** Badge fill + text colour, applied over the outline badge variant. */
  badgeClass: string;
  dotClass: string;
};

export const STAGES: PipelineStage[] = [
  {
    id: "lead",
    label: "Lead",
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
    id: "meeting",
    label: "Meeting",
    badgeClass: "bg-warning/15 text-warning",
    dotClass: "bg-warning",
  },
  {
    id: "diligence",
    label: "Diligence",
    badgeClass: "bg-primary/15 text-primary",
    dotClass: "bg-primary",
  },
  {
    id: "committed",
    label: "Committed",
    badgeClass: "bg-success/15 text-success",
    dotClass: "bg-success",
  },
  {
    id: "closed",
    label: "Closed",
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
    pipelineStageId: "diligence",
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
    pipelineStageId: "meeting",
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
    pipelineStageId: "meeting",
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
    pipelineStageId: "lead",
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
    pipelineStageId: "diligence",
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
    pipelineStageId: "lead",
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

export const pipelineDeals: PipelineDeal[] = investors.map((investor, index) => {
  const probabilityByStage: Record<PipelineStageId, number> = {
    lead: 10,
    contacted: 25,
    meeting: 45,
    diligence: 70,
    committed: 90,
    closed: 100,
    passed: 0,
  };

  return {
    id: `deal-${index + 1}`,
    investorId: investor.id,
    stageId: investor.pipelineStageId,
    expectedAmount: investor.amount,
    probabilityPercentage: probabilityByStage[investor.pipelineStageId],
  };
});

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