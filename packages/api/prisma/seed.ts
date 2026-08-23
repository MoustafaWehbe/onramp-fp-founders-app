import "dotenv/config";

import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/utils/auth";
import { PERMISSIONS, ROLE_TEMPLATES } from "../src/config/permissions";
import { PIPELINE_STAGES } from "../src/config/crm";
import { renderReviewerNda } from "../src/config/reviewer-nda";
import type {
  CommitmentStatus,
  InvestorType,
  PipelineStage,
  Priority,
} from "../src/config/crm";

// Prisma 7 requires an explicit driver adapter at runtime. Keep this in sync
// with src/db/prisma.ts because the seed script runs outside the API process.
const prisma = new PrismaClient({
  adapter: new PrismaPg(
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/raise",
  ),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deterministic ids, so a bookmarked demo link still resolves after a re-seed.
 * The group number keeps each entity family in its own readable range.
 */
const G = {
  USER: 1,
  STARTUP: 2,
  ROLE: 3,
  MEMBER: 4,
  INVESTOR: 5,
  ROUND: 6,
  PIPELINE: 7,
  STAGE_EVENT: 8,
  COMMITMENT: 9,
  STATUS_EVENT: 10,
  TASK: 11,
  LOG: 12,
  NOTIFICATION: 13,
  AUDIT: 14,
  DOCUMENT: 15,
  DOCUMENT_VERSION: 16,
  DOCUMENT_CHUNK: 17,
  CONVERSATION: 18,
  CONVERSATION_MEMBER: 19,
  MESSAGE: 20,
  MESSAGE_MENTION: 21,
  MESSAGE_REACTION: 22,
  REVIEWER_INVITATION: 23,
  REVIEWER_INVITATION_DOCUMENT: 24,
} as const;

const uid = (group: number, n: number): string =>
  `${group.toString(16).padStart(8, "0")}-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;

// One clock for the whole run, so a deal's stage history, its tasks and its
// commitment events stay consistent with each other.
const NOW = Date.now();
const days = (n: number) => new Date(NOW + n * 86_400_000);
const hours = (n: number) => new Date(NOW + n * 3_600_000);
const minutes = (n: number) => new Date(NOW + n * 60_000);

/**
 * "Due today" means later today, not this exact instant. The task queue sorts
 * anything already in the past into Overdue, so a due date stamped at seed time
 * would move buckets a millisecond after the seed finished.
 */
const endOfToday = () => {
  const d = new Date(NOW);
  d.setHours(23, 59, 59, 999);
  return d;
};

/** Every stage a deal can sit in while still live "passed" is the exit. */
const FUNNEL: PipelineStage[] = PIPELINE_STAGES.filter((s) => s !== "passed");

/** Shared by every seeded account, so any of them can be signed into quickly. */
const DEMO_PASSWORD = "Founder1234!";

// ─── Seed shapes ──────────────────────────────────────────────────────────────

type RoleName = keyof typeof ROLE_TEMPLATES;

interface UserSeed {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  authProvider?: "local" | "google";
}

interface MemberSeed {
  userKey: string;
  role: RoleName;
}

interface CommitmentSeed {
  amount: number;
  /** Ordered oldest-first; the last entry is the commitment's current status. */
  history: Array<{ status: CommitmentStatus; daysAgo: number }>;
  expectedCloseInDays?: number;
}

interface DealSeed {
  /** Which of the startup's rounds this deal belongs to. */
  round: string;
  stage: PipelineStage;
  /** Days ago the deal entered the funnel the start of its stage history. */
  sourcedDaysAgo: number;
  /** Days ago it reached its current stage the end of that history. */
  stageChangedDaysAgo: number;
  expectedAmount?: number;
  probabilityPercentage?: number;
  priority?: Priority;
  investorFitScore?: number;
  isLead?: boolean;
  ownerKey?: string;
  /** For a passed deal, the furthest stage it reached before dropping out. */
  passedAfter?: PipelineStage;
  commitment?: CommitmentSeed;
}

interface LogSeed {
  type: "call" | "email" | "meeting" | "note" | "other";
  subject: string;
  description?: string;
  daysAgo: number;
  authorKey?: string;
  /** Read-only history: follow-ups predate tasks and nothing writes them now. */
  followupInDays?: number;
  followupDoneDaysAgo?: number;
}

interface ContactSeed {
  key: string;
  fullName: string;
  email?: string;
  ventureFirm?: string;
  investorType: InvestorType;
  sectorFocus?: string;
  investmentStagePreference?: string;
  linkedinUrl?: string;
  source?: string;
  notes?: string;
  notesAuthorKey?: string;
  notesEditorKey?: string;
  notesAgeDays?: number;
  // The stable "who is this investor" profile the AI copilot reads see
  // StartupInvestor.description in schema.prisma for why this is kept apart from `notes`.
  description?: string;
  checkSizeMin?: number;
  checkSizeMax?: number;
  geographyFocus?: string;
  portfolioHighlights?: string;
  warmIntroPath?: string;
  deals?: DealSeed[];
  logs?: LogSeed[];
}

// The UI stores controlled option ids. Keeping the seed fixtures readable
// while normalizing at this boundary makes every seeded contact editable from
// the select controls without silently retaining a legacy free-text value.
const SECTOR_FOCUS_IDS: Record<string, string> = {
  "B2B SaaS": "b2b_saas",
  "Enterprise software": "b2b_saas",
  "Sales tech": "b2b_saas",
  "Developer tools": "developer_tools",
  Marketplaces: "marketplaces",
  "SaaS, AI": "ai_ml",
  Diversified: "other",
  Fintech: "fintech",
  Infrastructure: "developer_tools",
  Climate: "climate",
  "Fintech, SaaS": "fintech",
  "AI / Infrastructure": "ai_ml",
};

const STAGE_PREFERENCE_IDS: Record<string, string> = {
  pre_seed: "pre_seed",
  seed: "seed",
  series_a: "series_a",
  series_b: "series_b",
  growth: "growth",
  any_stage: "any_stage",
};

const SOURCE_IDS: Record<string, string> = {
  outbound: "cold_outreach",
  conference: "event",
  linkedin: "cold_outreach",
  warm_intro: "warm_intro",
  program: "accelerator",
  event: "event",
  referral: "referral",
};

function controlledSeedValue(value: string | undefined, options: Record<string, string>, field: string) {
  if (value === undefined) return null;
  const normalized = options[value];
  if (!normalized) throw new Error(`Unknown ${field} seed value: ${value}`);
  return normalized;
}

interface TaskSeed {
  contactKey: string;
  round: string;
  title: string;
  description?: string;
  priority: Priority;
  /** Negative is overdue, 0 is later today, positive is upcoming. Omit for none. */
  dueInDays?: number;
  assigneeKey?: string;
  creatorKey: string;
  completedDaysAgo?: number;
}

// ─── People ───────────────────────────────────────────────────────────────────

const USERS: UserSeed[] = [
  {
    key: "muhamad",
    firstName: "Muhamad",
    lastName: "Houda",
    email: "muhamad.houda@gmail.com",
  },
  { key: "raymond", firstName: "Raymond", lastName: "Rached", email: "raymond@northbeam.io" },
  {
    key: "rana",
    firstName: "Rana",
    lastName: "Nemer",
    email: "rana@northbeam.io",
    // Exercises the Google-account branch: no password, so a password login
    // must be refused with GOOGLE_ACCOUNT rather than INVALID_CREDENTIALS.
    authProvider: "google",
  },
  { key: "lopna", firstName: "Lopna", lastName: "Deeb", email: "lopna@northbeam.io" },
  { key: "karim", firstName: "Karim", lastName: "Baz", email: "karim@driftlabs.io" },
];

// ─── Northbeam the primary demo workspace ───────────────────────────────────

const NORTHBEAM_MEMBERS: MemberSeed[] = [
  { userKey: "muhamad", role: "owner" },
  { userKey: "raymond", role: "collaborator" },
  { userKey: "rana", role: "collaborator" },
  { userKey: "lopna", role: "viewer" },
];

const NORTHBEAM_CONTACTS: ContactSeed[] = [
  // ── Sourced ────────────────────────────────────────────────────────────────
  {
    key: "elena",
    fullName: "Elena Fischer",
    email: "elena.fischer@balderton.example.com",
    ventureFirm: "Balderton Capital",
    investorType: "vc",
    sectorFocus: "B2B SaaS",
    investmentStagePreference: "seed",
    linkedinUrl: "https://linkedin.com/in/elenafischer",
    source: "outbound",
    description: "Partner focused on European B2B SaaS, typically leads or co-leads seed rounds.",
    checkSizeMin: 500_000,
    checkSizeMax: 2_500_000,
    geographyFocus: "Europe, remote-friendly US",
    portfolioHighlights: "Revolut, GoCardless, Aircall",
    warmIntroPath: "Cold outreach only so far no shared connections found.",
    deals: [
      {
        round: "seed",
        stage: "sourced",
        sourcedDaysAgo: 8,
        stageChangedDaysAgo: 8,
        expectedAmount: 2_000_000,
        probabilityPercentage: 10,
        priority: "medium",
        investorFitScore: 72,
      },
    ],
  },
  {
    key: "hiroshi",
    fullName: "Hiroshi Sato",
    email: "h.sato@globalbrain.example.com",
    ventureFirm: "Global Brain",
    investorType: "vc",
    sectorFocus: "Enterprise software",
    investmentStagePreference: "seed",
    source: "conference",
    description: "APAC-focused enterprise software investor, looking to build a US bridge for portfolio companies.",
    checkSizeMin: 300_000,
    checkSizeMax: 1_500_000,
    geographyFocus: "Japan, Southeast Asia",
    portfolioHighlights: "Mercari, Sansan",
    deals: [
      {
        round: "seed",
        stage: "sourced",
        sourcedDaysAgo: 12,
        stageChangedDaysAgo: 12,
        expectedAmount: 1_200_000,
        probabilityPercentage: 10,
        priority: "low",
        investorFitScore: 58,
      },
    ],
  },
  {
    key: "nadia",
    fullName: "Nadia Rahman",
    email: "nadia.rahman@example.com",
    investorType: "angel",
    sectorFocus: "Sales tech",
      investmentStagePreference: "seed",
    source: "linkedin",
    // A deal with no owner and no next step the "needs attention" reminder job
    // is meant to pick exactly this up.
    deals: [
      {
        round: "pre_seed",
        stage: "committed",
        sourcedDaysAgo: 395,
        stageChangedDaysAgo: 346,
        expectedAmount: 75_000,
        probabilityPercentage: 100,
        commitment: {
          amount: 75_000,
          history: [
            { status: "soft_circled", daysAgo: 355 },
            { status: "wired", daysAgo: 344 },
          ],
        },
      },
      {
        round: "seed",
        stage: "sourced",
        sourcedDaysAgo: 5,
        stageChangedDaysAgo: 5,
        expectedAmount: 150_000,
        probabilityPercentage: 15,
      },
    ],
  },

  // ── Contacted ──────────────────────────────────────────────────────────────
  {
    key: "marcus",
    fullName: "Marcus Webb",
    email: "marcus.webb@indexventures.example.com",
    ventureFirm: "Index Ventures",
    investorType: "vc",
    sectorFocus: "Developer tools",
    investmentStagePreference: "seed",
    source: "warm_intro",
    description: "Leads Index's developer-tools thesis, known for moving fast once he's met the full team.",
    checkSizeMin: 1_000_000,
    checkSizeMax: 3_000_000,
    geographyFocus: "Global, prefers in-person diligence",
    portfolioHighlights: "Figma, Notion, Loom",
    warmIntroPath: "Ravi at Loom introduced us directly.",
    notes: "Wants to meet the full founding team before going further.",
    notesAuthorKey: "muhamad",
    notesEditorKey: "raymond",
    notesAgeDays: 6,
    deals: [
      {
        round: "seed",
        stage: "contacted",
        sourcedDaysAgo: 30,
        stageChangedDaysAgo: 21,
        expectedAmount: 1_500_000,
        probabilityPercentage: 25,
        priority: "high",
        investorFitScore: 81,
        ownerKey: "muhamad",
      },
    ],
    logs: [
      {
        type: "email",
        subject: "Intro from Ravi at Loom",
        description: "Warm intro landed. Marcus replied same day asking for the deck.",
        daysAgo: 28,
        authorKey: "muhamad",
      },
      {
        type: "call",
        subject: "First screening call",
        description: "30 minutes. Liked the wedge, pushed hard on net revenue retention.",
        daysAgo: 20,
        authorKey: "muhamad",
      },
      {
        type: "note",
        subject: "Note on next steps",
        description: "Wants to meet the full founding team before going further.",
        daysAgo: 5,
        authorKey: "raymond",
      },
    ],
  },
  {
    key: "clara",
    fullName: "Clara Beaumont",
    email: "clara@kimaventures.example.com",
    ventureFirm: "Kima Ventures",
    investorType: "vc",
    investmentStagePreference: "seed",
    source: "outbound",
    description: "High-volume seed investor, writes smaller checks but moves fast and rarely leads.",
    checkSizeMin: 100_000,
    checkSizeMax: 400_000,
    geographyFocus: "Europe",
    deals: [
      {
        round: "seed",
        stage: "committed",
        sourcedDaysAgo: 19,
        stageChangedDaysAgo: 2,
        expectedAmount: 250_000,
        probabilityPercentage: 100,
        priority: "high",
        ownerKey: "rana",
        commitment: {
          amount: 250_000,
          history: [
            { status: "soft_circled", daysAgo: 9 },
            { status: "hard_circled", daysAgo: 5 },
            { status: "wired", daysAgo: 2 },
          ],
        },
      },
    ],
  },

  // ── Meeting scheduled ──────────────────────────────────────────────────────
  {
    key: "james",
    fullName: "James O'Brien",
    email: "james.obrien@accel.example.com",
    ventureFirm: "Accel",
    investorType: "vc",
    sectorFocus: "B2B SaaS",
    investmentStagePreference: "series_a",
    source: "outbound",
    description: "Growth-stage partner but will do a late seed if metrics clear their Series A bar.",
    checkSizeMin: 1_500_000,
    checkSizeMax: 5_000_000,
    geographyFocus: "US, UK",
    portfolioHighlights: "UiPath, Deliveroo, Supercell",
    notes: "Asked for cohort retention split by segment ahead of the partner meeting.",
    notesAuthorKey: "raymond",
    notesAgeDays: 3,
    deals: [
      {
        round: "seed",
        stage: "meeting_scheduled",
        sourcedDaysAgo: 45,
        stageChangedDaysAgo: 9,
        expectedAmount: 2_500_000,
        probabilityPercentage: 40,
        priority: "high",
        investorFitScore: 88,
        ownerKey: "muhamad",
      },
    ],
    logs: [
      {
        type: "email",
        subject: "Cold outreach Northbeam",
        description: "Replied in two days, asked for deck and metrics.",
        daysAgo: 43,
        authorKey: "muhamad",
      },
      {
        type: "meeting",
        subject: "Intro call with James",
        description: "45 minutes. Wants to bring in a second partner.",
        daysAgo: 12,
        authorKey: "muhamad",
      },
      {
        type: "other",
        subject: "Sent metrics appendix",
        description: "Shared the cohort breakdown he asked for.",
        daysAgo: 4,
        authorKey: "raymond",
      },
      {
        type: "note",
        subject: "Note ahead of partner meeting",
        description: "Asked for cohort retention split by segment ahead of the partner meeting.",
        daysAgo: 3,
        authorKey: "raymond",
      },
    ],
  },
  {
    key: "aisha",
    fullName: "Aisha Mensah",
    email: "aisha.mensah@yc.example.com",
    ventureFirm: "Y Combinator",
    investorType: "accelerator",
    investmentStagePreference: "pre_seed",
    source: "program",
    description: "YC partner running point on our batch, also invests personally on follow-on rounds.",
    checkSizeMin: 125_000,
    checkSizeMax: 500_000,
    geographyFocus: "Global, YC network",
    warmIntroPath: "Met through the YC batch program directly.",
    deals: [
      {
        round: "pre_seed",
        stage: "committed",
        sourcedDaysAgo: 400,
        stageChangedDaysAgo: 350,
        expectedAmount: 125_000,
        probabilityPercentage: 100,
        commitment: {
          amount: 125_000,
          history: [
            { status: "soft_circled", daysAgo: 360 },
            { status: "hard_circled", daysAgo: 352 },
            { status: "wired", daysAgo: 344 },
          ],
        },
      },
    ],
    logs: [
      {
        type: "meeting",
        subject: "YC batch close",
        description: "Completed the pre-seed investment and archived the closing documents.",
        daysAgo: 344,
        authorKey: "muhamad",
      },
    ],
  },
  {
    key: "peter",
    fullName: "Peter Lindqvist",
    email: "peter@creandum.example.com",
    ventureFirm: "Creandum",
      investorType: "vc",
    investmentStagePreference: "seed",
    source: "warm_intro",
    checkSizeMin: 750_000,
    checkSizeMax: 2_000_000,
    geographyFocus: "Nordics, DACH",
    portfolioHighlights: "Klarna, Spotify, Small Giant Games",
    deals: [
      {
        round: "seed",
        stage: "meeting_scheduled",
        sourcedDaysAgo: 33,
        stageChangedDaysAgo: 13,
        expectedAmount: 1_800_000,
        probabilityPercentage: 35,
        priority: "medium",
        investorFitScore: 69,
        ownerKey: "raymond",
      },
    ],
    logs: [
      {
        type: "call",
        subject: "Screening call",
        daysAgo: 14,
        authorKey: "raymond",
        // Legacy shape a planned follow-up that was later satisfied.
        followupInDays: -7,
        followupDoneDaysAgo: 5,
      },
    ],
  },

  // ── Due diligence ──────────────────────────────────────────────────────────
  {
    key: "sarah",
    fullName: "Sarah Chen",
    email: "sarah.chen@sequoiacap.example.com",
    ventureFirm: "Sequoia Capital",
    investorType: "vc",
    sectorFocus: "SaaS, AI",
    investmentStagePreference: "seed",
    linkedinUrl: "https://linkedin.com/in/sarahchen",
    source: "event",
    description: "Partner leading the deal, historically a strong signer once GTM and NRR check out in diligence.",
    checkSizeMin: 1_000_000,
    checkSizeMax: 4_000_000,
    geographyFocus: "Global, prefers US-incorporated",
    portfolioHighlights: "Zoom, Stripe, Snowflake",
    warmIntroPath: "Met directly at TechCrunch Disrupt no shared connection needed.",
    deals: [
      {
        round: "seed",
        stage: "due_diligence",
        sourcedDaysAgo: 72,
        stageChangedDaysAgo: 10,
        expectedAmount: 2_500_000,
        probabilityPercentage: 70,
        priority: "high",
        investorFitScore: 92,
        isLead: true,
        ownerKey: "muhamad",
      },
    ],
    logs: [
      {
        type: "meeting",
        subject: "Met at TechCrunch Disrupt",
        description: "Ten minutes at the booth. Asked us to send the deck.",
        daysAgo: 70,
        authorKey: "muhamad",
      },
      {
        type: "email",
        subject: "Deck and metrics",
        daysAgo: 66,
        authorKey: "muhamad",
      },
      {
        type: "meeting",
        subject: "Partner meeting",
        description: "Full partnership. Strong on the GTM motion, wants customer references.",
        daysAgo: 24,
        authorKey: "muhamad",
      },
      {
        type: "call",
        subject: "Diligence kickoff",
        description: "Walked through the data room structure. Legal starts Monday.",
        daysAgo: 9,
        authorKey: "muhamad",
      },
      {
        type: "note",
        subject: "Note on data room review",
        description: "Prospective lead. Legal is reviewing the data room; wants a 15% option pool.",
        daysAgo: 1,
        authorKey: "muhamad",
      },
    ],
  },

  // ── Term sheet ─────────────────────────────────────────────────────────────
  {
    key: "owen",
    fullName: "Owen Wright",
    email: "owen@lodestar.example.com",
    ventureFirm: "Lodestar VC",
    investorType: "vc",
    sectorFocus: "Climate",
    investmentStagePreference: "series_a",
    source: "outbound",
    description: "Climate-adjacent thesis, soft-circled but the expected close has already slipped once.",
    checkSizeMin: 300_000,
    checkSizeMax: 1_000_000,
    geographyFocus: "Europe",
    deals: [
      {
        round: "seed",
        stage: "term_sheet",
        sourcedDaysAgo: 64,
        stageChangedDaysAgo: 15,
        expectedAmount: 600_000,
        probabilityPercentage: 75,
        priority: "medium",
        investorFitScore: 70,
        ownerKey: "muhamad",
        commitment: {
          amount: 600_000,
          history: [{ status: "soft_circled", daysAgo: 15 }],
          // Deliberately in the past an at-risk commitment the forecast panel
          // is supposed to flag rather than quietly count.
          expectedCloseInDays: -4,
        },
      },
    ],
  },

  // ── Committed ──────────────────────────────────────────────────────────────

  // ── Passed ─────────────────────────────────────────────────────────────────

  // ── Not in any pipeline the "Add to pipeline" roster ─────────────────────
];

const NORTHBEAM_TASKS: TaskSeed[] = [
  {
    contactKey: "sarah",
    round: "seed",
    title: "Introduce Sarah to customer references",
    description: "Send the two approved customer introductions Sequoia needs to finish commercial diligence.",
    priority: "high",
    dueInDays: 0,
    assigneeKey: "muhamad",
    creatorKey: "muhamad",
  },
  {
    contactKey: "owen",
    round: "seed",
    title: "Chase Lodestar on signature",
    description: "The $600k soft circle is overdue. Confirm the signer, timing, and whether the allocation is still live.",
    priority: "high",
    dueInDays: -1,
    assigneeKey: "muhamad",
    creatorKey: "muhamad",
  },
  {
    contactKey: "james",
    round: "seed",
    title: "Prepare Accel partner meeting brief",
    description: "Package the cohort-retention answer, meeting goals, and likely partner objections before today's call.",
    priority: "high",
    dueInDays: 0,
    assigneeKey: "muhamad",
    creatorKey: "muhamad",
  },
  {
    contactKey: "marcus",
    round: "seed",
    title: "Schedule Index founding-team intro",
    description: "Offer two times with all three founders and include the updated NRR slide.",
    priority: "medium",
    dueInDays: 2,
    assigneeKey: "muhamad",
    creatorKey: "raymond",
  },
  {
    contactKey: "peter",
    round: "seed",
    title: "Send Creandum the metrics appendix",
    description: "Share the segment-level retention and expansion tables discussed on the screening call.",
    priority: "medium",
    dueInDays: 3,
    assigneeKey: "raymond",
    creatorKey: "raymond",
  },
  {
    contactKey: "clara",
    round: "seed",
    title: "File Kima wire confirmation",
    description: "Attach the $250k receipt and countersigned closing documents to the seed round.",
    priority: "medium",
    dueInDays: -2,
    assigneeKey: "rana",
    creatorKey: "muhamad",
    completedDaysAgo: 1,
  },
  {
    contactKey: "elena",
    round: "seed",
    title: "Find a warm path to Balderton",
    description: "Check customer and founder networks before sending a second cold message.",
    priority: "medium",
    dueInDays: 6,
    assigneeKey: "rana",
    creatorKey: "muhamad",
  },
  {
    contactKey: "hiroshi",
    round: "seed",
    title: "Send Global Brain the APAC expansion note",
    description: "Explain the US-first plan and how the product can support Japanese enterprise teams later.",
    priority: "low",
    dueInDays: 8,
    assigneeKey: "raymond",
    creatorKey: "muhamad",
  },
  {
    contactKey: "sarah",
    round: "seed",
    title: "Prepare data room index",
    description: "Organize financial, legal, product, and customer folders for Sequoia's diligence kickoff.",
    priority: "medium",
    dueInDays: -12,
    assigneeKey: "muhamad",
    creatorKey: "muhamad",
    completedDaysAgo: 11,
  },
];

// ─── Drift Labs a second workspace, non-USD, where the owner is a guest ─────

const DRIFT_MEMBERS: MemberSeed[] = [
  { userKey: "karim", role: "owner" },
  // Same person, lesser role: proves permissions are per-workspace and gives
  // the workspace switcher something real to switch to.
  { userKey: "muhamad", role: "collaborator" },
];

const DRIFT_CONTACTS: ContactSeed[] = [
  {
    key: "isabelle",
    fullName: "Isabelle Roux",
    email: "isabelle@partech.example.com",
    ventureFirm: "Partech",
    investorType: "vc",
    investmentStagePreference: "seed",
    source: "warm_intro",
    description: "Leading the round, currently the deal's designated lead investor.",
    checkSizeMin: 400_000,
    checkSizeMax: 1_200_000,
    geographyFocus: "France, Southern Europe",
    portfolioHighlights: "BlaBlaCar, Watchfinder",
    deals: [
      {
        round: "seed_eur",
        stage: "due_diligence",
        sourcedDaysAgo: 40,
        stageChangedDaysAgo: 6,
        expectedAmount: 800_000,
        probabilityPercentage: 65,
        priority: "high",
        isLead: true,
        ownerKey: "karim",
      },
    ],
  },
  {
    key: "stefan",
    fullName: "Stefan Kohl",
    email: "stefan@cherry.example.com",
    ventureFirm: "Cherry Ventures",
    investorType: "vc",
    investmentStagePreference: "seed",
    source: "outbound",
    description: "Hard-circled, wire expected with the round close.",
    checkSizeMin: 250_000,
    checkSizeMax: 900_000,
    geographyFocus: "DACH, Benelux",
    deals: [
      {
        round: "seed_eur",
        stage: "committed",
        sourcedDaysAgo: 55,
        stageChangedDaysAgo: 14,
        expectedAmount: 400_000,
        probabilityPercentage: 100,
        ownerKey: "karim",
        commitment: {
          amount: 400_000,
          history: [
            { status: "soft_circled", daysAgo: 22 },
            { status: "hard_circled", daysAgo: 13 },
          ],
          expectedCloseInDays: 15,
        },
      },
    ],
  },
  {
    key: "mireille",
    fullName: "Mireille Dubois",
    email: "mireille@example.com",
    investorType: "angel",
    source: "referral",
    checkSizeMin: 25_000,
    checkSizeMax: 100_000,
    geographyFocus: "France",
    deals: [
      {
        round: "seed_eur",
        stage: "meeting_scheduled",
        sourcedDaysAgo: 21,
        stageChangedDaysAgo: 5,
        expectedAmount: 75_000,
        probabilityPercentage: 45,
        ownerKey: "muhamad",
      },
    ],
  },
  {
    key: "anders",
    fullName: "Anders Holm",
    email: "anders@northzone.example.com",
    ventureFirm: "Northzone",
    investorType: "vc",
    source: "conference",
    description: "Newly sourced, climate/logistics-adjacent thesis fund out of the Nordics.",
    checkSizeMin: 500_000,
    checkSizeMax: 1_500_000,
    geographyFocus: "Nordics, wider Europe",
    deals: [
      {
        round: "seed_eur",
        stage: "sourced",
        sourcedDaysAgo: 9,
        stageChangedDaysAgo: 9,
        expectedAmount: 1_000_000,
        probabilityPercentage: 10,
      },
    ],
  },
  {
    key: "bruno",
    fullName: "Bruno Ferreira",
    email: "bruno@indico.example.com",
    ventureFirm: "Indico Capital",
    investorType: "vc",
    source: "outbound",
  },
];

const DRIFT_TASKS: TaskSeed[] = [
  {
    contactKey: "isabelle",
    round: "seed_eur",
    title: "Send updated cap table",
    priority: "high",
    dueInDays: -2,
    assigneeKey: "karim",
    creatorKey: "karim",
  },
  {
    contactKey: "stefan",
    round: "seed_eur",
    title: "Confirm Cherry Ventures wire date",
    description: "Verify closing documents and the expected date for the €400k hard circle.",
    priority: "high",
    dueInDays: 0,
    assigneeKey: "karim",
    creatorKey: "karim",
  },
  {
    contactKey: "mireille",
    round: "seed_eur",
    title: "Book the follow-up call",
    priority: "medium",
    dueInDays: 3,
    assigneeKey: "muhamad",
    creatorKey: "karim",
  },
];

// ─── Builders ─────────────────────────────────────────────────────────────────

/** Sequential counters keep every generated id unique and stable per run. */
const counters: Record<string, number> = {};
const nextId = (group: number): string => {
  const n = (counters[group] = (counters[group] ?? 0) + 1);
  return uid(group, n);
};

/**
 * The stages a deal actually moved through, oldest first. A live deal walked
 * the funnel up to where it sits now; a passed deal walked it only as far as
 * `passedAfter` before dropping out.
 */
function stagePath(deal: DealSeed): PipelineStage[] {
  if (deal.stage !== "passed") {
    return FUNNEL.slice(0, FUNNEL.indexOf(deal.stage) + 1);
  }
  const reached = deal.passedAfter ?? "contacted";
  return [...FUNNEL.slice(0, FUNNEL.indexOf(reached) + 1), "passed"];
}

/**
 * Spreads a deal's stage changes evenly between when it was sourced and when
 * it reached its current stage, so velocity and conversion charts have real
 * elapsed time to measure rather than a single timestamp.
 */
function stageDates(deal: DealSeed, count: number): Date[] {
  if (count <= 1) return [days(-deal.sourcedDaysAgo)];
  const span = deal.sourcedDaysAgo - deal.stageChangedDaysAgo;
  return Array.from({ length: count }, (_, i) =>
    days(-(deal.sourcedDaysAgo - (span * i) / (count - 1))),
  );
}

async function createRoles(startupId: string, permByKey: Record<string, { id: string }>) {
  const roles: Record<string, { id: string }> = {};

  for (const name of Object.keys(ROLE_TEMPLATES) as RoleName[]) {
    const role = await prisma.role.create({
      data: {
        id: nextId(G.ROLE),
        startupId,
        name,
        description: {
          owner: "Full access to all resources",
          collaborator: "Can edit pipeline and documents, no billing access",
          viewer: "Read-only access",
        }[name],
        isSystemRole: true,
      },
    });
    roles[name] = role;

    for (const key of ROLE_TEMPLATES[name]) {
      const perm = permByKey[key];
      if (!perm) continue;
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
  }

  return roles;
}

interface WorkspaceSeed {
  id: string;
  name: string;
  description: string;
  industry: string;
  website: string;
  fundingStage: string;
  // Structured comparables the AI copilot reads directly see
  // Startup.oneLiner etc. in schema.prisma.
  oneLiner?: string;
  problemStatement?: string;
  solutionSummary?: string;
  targetMarket?: string;
  businessModel?: string;
  tractionSummary?: string;
  competitiveEdge?: string;
  headquarters?: string;
  foundedAt?: Date;
  teamSummary?: string;
  creatorKey: string;
  members: MemberSeed[];
  rounds: Array<{
    key: string;
    roundName: string;
    targetAmount: number;
    minimumTicketSize?: number;
    equityOfferedPercentage?: number;
    currency: string;
    status: string;
    firstCloseInDays?: number;
    targetCloseInDays?: number;
  }>;
  contacts: ContactSeed[];
  tasks: TaskSeed[];
}

async function seedWorkspace(
  spec: WorkspaceSeed,
  usersByKey: Map<string, { id: string; firstName: string; lastName: string }>,
  permByKey: Record<string, { id: string }>,
) {
  // A presentation workspace should never open on a fundraising round whose
  // headline "Raised" amount is zero. Only hard-circled and wired money is
  // bankable in the product, so require at least one such commitment per round.
  for (const round of spec.rounds) {
    const bankableTotal = spec.contacts
      .flatMap((contact) => contact.deals ?? [])
      .filter((deal) => deal.round === round.key && deal.commitment)
      .reduce((total, deal) => {
        const currentStatus = deal.commitment!.history.at(-1)?.status;
        return currentStatus === "hard_circled" || currentStatus === "wired"
          ? total + deal.commitment!.amount
          : total;
      }, 0);

    if (bankableTotal <= 0) {
      throw new Error(`Presentation round "${round.key}" in ${spec.name} needs a bankable commitment`);
    }
  }

  const startup = await prisma.startup.create({
    data: {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      industry: spec.industry,
      website: spec.website,
      fundingStage: spec.fundingStage,
      oneLiner: spec.oneLiner ?? null,
      problemStatement: spec.problemStatement ?? null,
      solutionSummary: spec.solutionSummary ?? null,
      targetMarket: spec.targetMarket ?? null,
      businessModel: spec.businessModel ?? null,
      tractionSummary: spec.tractionSummary ?? null,
      competitiveEdge: spec.competitiveEdge ?? null,
      headquarters: spec.headquarters ?? null,
      foundedAt: spec.foundedAt ?? null,
      teamSummary: spec.teamSummary ?? null,
      createdBy: usersByKey.get(spec.creatorKey)!.id,
    },
  });

  const roles = await createRoles(startup.id, permByKey);

  const membersByKey = new Map<string, { id: string }>();
  for (const seed of spec.members) {
    const member = await prisma.startupMember.create({
      data: {
        id: nextId(G.MEMBER),
      startupId: startup.id,
        userId: usersByKey.get(seed.userKey)!.id,
        roleId: roles[seed.role].id,
      status: "active",
        joinedAt: days(-120),
    },
  });
    membersByKey.set(seed.userKey, member);
  }

  const roundsByKey = new Map<string, { id: string; currency: string }>();
  for (const seed of spec.rounds) {
    const round = await prisma.fundraisingRound.create({
      data: {
        id: nextId(G.ROUND),
      startupId: startup.id,
        roundName: seed.roundName,
        targetAmount: seed.targetAmount,
        minimumTicketSize: seed.minimumTicketSize ?? null,
        equityOfferedPercentage: seed.equityOfferedPercentage ?? null,
        currency: seed.currency,
        status: seed.status,
        firstCloseDate: seed.firstCloseInDays === undefined ? null : days(seed.firstCloseInDays),
        targetCloseDate: seed.targetCloseInDays === undefined ? null : days(seed.targetCloseInDays),
    },
  });
    roundsByKey.set(seed.key, round);
  }

  const contactsByKey = new Map<string, { id: string; fullName: string; ventureFirm: string | null }>();
  // Keyed "contactKey:roundKey" a contact can hold one deal per round.
  const dealsByKey = new Map<string, { id: string }>();
  const sortOrders: Record<string, number> = {};
  let dealCount = 0;
  let commitmentCount = 0;
  let logCount = 0;

  for (const seed of spec.contacts) {
    const author = seed.notesAuthorKey ? usersByKey.get(seed.notesAuthorKey) : undefined;
    const editor = seed.notesEditorKey ? usersByKey.get(seed.notesEditorKey) : undefined;
    const notesAge = seed.notesAgeDays ?? 0;

    const contact = await prisma.startupInvestor.create({
      data: {
        id: nextId(G.INVESTOR),
        startupId: startup.id,
        fullName: seed.fullName,
        email: seed.email ?? null,
        ventureFirm: seed.ventureFirm ?? null,
        investorType: seed.investorType,
        sectorFocus: controlledSeedValue(seed.sectorFocus, SECTOR_FOCUS_IDS, "sector focus"),
        investmentStagePreference: controlledSeedValue(
          seed.investmentStagePreference,
          STAGE_PREFERENCE_IDS,
          "stage preference",
        ),
        linkedinUrl: seed.linkedinUrl ?? null,
        source: controlledSeedValue(seed.source, SOURCE_IDS, "source"),
        description: seed.description ?? null,
        checkSizeMin: seed.checkSizeMin ?? null,
        checkSizeMax: seed.checkSizeMax ?? null,
        geographyFocus: seed.geographyFocus ?? null,
        portfolioHighlights: seed.portfolioHighlights ?? null,
        warmIntroPath: seed.warmIntroPath ?? null,
        notes: seed.notes ?? null,
        notesCreatedBy: author?.id ?? null,
        notesCreatedAt: seed.notes ? days(-notesAge) : null,
        notesUpdatedBy: editor?.id ?? null,
        // Only an edited note carries an update stamp — an untouched one would
        // otherwise render as "edited" the moment it was written.
        notesUpdatedAt: editor ? days(-Math.max(0, notesAge - 1)) : null,
      },
    });
    contactsByKey.set(seed.key, contact);

    for (const deal of seed.deals ?? []) {
      const round = roundsByKey.get(deal.round);
      if (!round) throw new Error(`Unknown round "${deal.round}" for contact "${seed.key}"`);

      const stageKey = `${deal.round}:${deal.stage}`;
      sortOrders[stageKey] = (sortOrders[stageKey] ?? 0) + 1;

      const entry = await prisma.pipeline.create({
        data: {
          id: nextId(G.PIPELINE),
      startupId: startup.id,
          roundId: round.id,
          startupInvestorId: contact.id,
          stage: deal.stage,
          expectedAmount: deal.expectedAmount ?? null,
          probabilityPercentage: deal.probabilityPercentage ?? null,
          priority: deal.priority ?? null,
          investorFitScore: deal.investorFitScore ?? null,
          isLead: deal.isLead ?? false,
          sortOrder: sortOrders[stageKey] * 1000,
          ownerId: deal.ownerKey ? (membersByKey.get(deal.ownerKey)?.id ?? null) : null,
          stageChangedAt: days(-deal.stageChangedDaysAgo),
          createdAt: days(-deal.sourcedDaysAgo),
    },
  });
      dealsByKey.set(`${seed.key}:${deal.round}`, entry);
      dealCount += 1;

      // Stage history what the conversion and velocity panels read.
      const path = stagePath(deal);
      const dates = stageDates(deal, path.length);
      for (const [i, stage] of path.entries()) {
        await prisma.pipelineStageEvent.create({
          data: {
            id: nextId(G.STAGE_EVENT),
            startupId: startup.id,
            roundId: round.id,
            pipelineId: entry.id,
            fromStage: i === 0 ? null : path[i - 1],
            toStage: stage,
            reason: stage === "passed" ? "Not a fit for the current fund" : null,
            changedBy: deal.ownerKey
              ? (usersByKey.get(deal.ownerKey)?.id ?? null)
              : usersByKey.get(spec.creatorKey)!.id,
            createdAt: dates[i],
    },
  });
      }

      if (!deal.commitment) continue;

      const { amount, history, expectedCloseInDays } = deal.commitment;
      const current = history[history.length - 1];

      const commitment = await prisma.commitment.create({
        data: {
          id: nextId(G.COMMITMENT),
      startupId: startup.id,
          startupInvestorId: contact.id,
          pipelineId: entry.id,
          roundId: round.id,
          amount,
          status: current.status,
          expectedCloseDate:
            expectedCloseInDays === undefined ? null : days(expectedCloseInDays),
          createdAt: days(-history[0].daysAgo),
    },
  });
      commitmentCount += 1;

      // Status history without these the funding chart can only plot the day
      // each commitment was recorded, not when the money actually hardened.
      for (const [i, step] of history.entries()) {
        await prisma.commitmentStatusEvent.create({
          data: {
            id: nextId(G.STATUS_EVENT),
      startupId: startup.id,
            commitmentId: commitment.id,
            fromStatus: i === 0 ? null : history[i - 1].status,
            toStatus: step.status,
            changedBy: usersByKey.get(deal.ownerKey ?? spec.creatorKey)!.id,
            createdAt: days(-step.daysAgo),
    },
  });
      }
    }

    for (const log of seed.logs ?? []) {
      // Attach the log to whichever deal of this contact is closest in time —
      // in practice the round that was open when the conversation happened.
      const dealForLog = (seed.deals ?? [])
        .filter((d) => d.sourcedDaysAgo >= log.daysAgo)
        .sort((a, b) => a.sourcedDaysAgo - b.sourcedDaysAgo)[0];
      const entry = dealForLog ? dealsByKey.get(`${seed.key}:${dealForLog.round}`) : undefined;

      await prisma.interactionLog.create({
        data: {
          id: nextId(G.LOG),
          startupInvestorId: contact.id,
          pipelineId: entry?.id ?? null,
          createdBy: usersByKey.get(log.authorKey ?? spec.creatorKey)!.id,
          type: log.type,
          subject: log.subject,
          description: log.description ?? null,
          interactionDate: days(-log.daysAgo),
          nextFollowupDate:
            log.followupInDays === undefined ? null : days(-log.followupInDays),
          followupCompletedAt:
            log.followupDoneDaysAgo === undefined ? null : days(-log.followupDoneDaysAgo),
          createdAt: days(-log.daysAgo),
        },
      });
      logCount += 1;
    }
  }

  // Keyed by title titles are unique within a workspace's seed fixtures, and
  // chat seeding below needs a real task id to build a "share a task" message.
  const tasksByKey = new Map<string, { id: string; title: string }>();

  for (const seed of spec.tasks) {
    const entry = dealsByKey.get(`${seed.contactKey}:${seed.round}`);
    if (!entry) throw new Error(`Task "${seed.title}" has no deal for ${seed.contactKey}`);

    const task = await prisma.task.create({
      data: {
        id: nextId(G.TASK),
      startupId: startup.id,
        pipelineId: entry.id,
        title: seed.title,
        description: seed.description ?? null,
        status: seed.completedDaysAgo === undefined ? "open" : "completed",
        priority: seed.priority,
        dueDate:
          seed.dueInDays === undefined
            ? null
            : seed.dueInDays === 0
              ? endOfToday()
              : days(seed.dueInDays),
        assigneeId: seed.assigneeKey ? (membersByKey.get(seed.assigneeKey)?.id ?? null) : null,
        completedAt: seed.completedDaysAgo === undefined ? null : days(-seed.completedDaysAgo),
        createdBy: usersByKey.get(seed.creatorKey)!.id,
      },
    });
    tasksByKey.set(seed.title, task);
  }

  return {
    startup,
    roles,
    membersByKey,
    tasksByKey,
    roundsByKey,
    contactsByKey,
    dealsByKey,
    counts: { dealCount, commitmentCount, logCount, taskCount: spec.tasks.length },
  };
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

type MentionTargetType = "member" | "investor" | "deal" | "task" | "round" | "document";

/** Same token format the composer's MentionPicker and Share menu write see packages/api/src/utils/mentions.ts. */
function mentionToken(type: MentionTargetType, id: string, label: string): string {
  return `@[${label}](${type}:${id})`;
}

let seedNonceCounter = 0;
const nextNonce = () => `seed-nonce-${++seedNonceCounter}`;

/**
 * Team chat for Northbeam only the workspace the demo opens on. Gives the
 * Chat page real content to render: a multi-person channel with grouped
 * consecutive messages, a reply thread, reactions, a teammate @mention, and
 * one of each shareable entity (investor, deal, task, round) so every
 * EntityUnfurl card variant shows up somewhere; plus a DM with an unread
 * message so the sidebar badge and the new direct-message notification both
 * have something real to point at.
 */
async function seedChat(
  startup: { id: string },
  membersByKey: Map<string, { id: string }>,
  usersByKey: Map<string, { id: string; firstName: string; lastName: string }>,
  contactsByKey: Map<string, { id: string; fullName: string; ventureFirm: string | null }>,
  dealsByKey: Map<string, { id: string }>,
  roundsByKey: Map<string, { id: string; currency: string }>,
  tasksByKey: Map<string, { id: string; title: string }>,
) {
  const muhamad = membersByKey.get("muhamad")!;
  const raymond = membersByKey.get("raymond")!;
  const rana = membersByKey.get("rana")!;
  const lopna = membersByKey.get("lopna")!;
  const muhamadUserId = usersByKey.get("muhamad")!.id;

  const clara = contactsByKey.get("clara")!;
  const claraSeedDeal = dealsByKey.get("clara:seed")!;
  const james = dealsByKey.get("james:seed")!;
  const seedRound = roundsByKey.get("seed")!;
  const lodestarTask = tasksByKey.get("Chase Lodestar on signature")!;

  async function send(
    conversationId: string,
    senderMemberId: string,
    body: string,
    createdAt: Date,
    parentMessageId?: string,
  ) {
    return prisma.message.create({
      data: {
        id: nextId(G.MESSAGE),
        startupId: startup.id,
        conversationId,
        senderId: senderMemberId,
        body,
        clientNonce: nextNonce(),
        parentMessageId: parentMessageId ?? null,
        createdAt,
      },
    });
  }

  async function mention(conversationId: string, messageId: string, type: MentionTargetType, targetId: string) {
    const column =
      type === "member"
        ? { mentionedMemberId: targetId }
        : type === "investor"
          ? { investorId: targetId }
          : type === "deal"
            ? { pipelineId: targetId }
            : type === "task"
              ? { taskId: targetId }
              : type === "round"
                ? { roundId: targetId }
                : { documentId: targetId };

    await prisma.messageMention.create({
      data: {
        id: nextId(G.MESSAGE_MENTION),
        startupId: startup.id,
        messageId,
        conversationId,
        targetType: type,
        ...column,
      },
    });
  }

  async function react(messageId: string, memberId: string, emoji: string) {
    await prisma.messageReaction.create({
      data: { id: nextId(G.MESSAGE_REACTION), startupId: startup.id, messageId, memberId, emoji },
    });
  }

  async function join(conversationId: string, memberIds: string[], readSeq: bigint | null, readAt: Date | null) {
    for (const memberId of memberIds) {
      await prisma.conversationMember.create({
        data: {
          id: nextId(G.CONVERSATION_MEMBER),
          startupId: startup.id,
          conversationId,
          memberId,
          joinedAt: days(-120),
          lastReadSeq: readSeq,
          lastReadAt: readAt,
        },
      });
    }
  }

  // ── #general the whole team ──────────────────────────────────────────────
  const general = await prisma.conversation.create({
    data: {
      id: nextId(G.CONVERSATION),
      startupId: startup.id,
      type: "channel",
      name: "general",
      topic: "Team-wide updates and quick questions.",
      createdBy: muhamadUserId,
      lastMessageAt: minutes(-5),
    },
  });

  await send(general.id, muhamad.id, "Welcome to Northbeam's team chat 👋 This is #general deal talk lives in #fundraising.", minutes(-300));
  await send(general.id, raymond.id, "Sounds good, I'll keep pipeline chatter over there then.", minutes(-295));

  const g3 = await send(
    general.id,
    rana.id,
    `Quick one ${mentionToken("member", muhamad.id, "Muhamad Houda")} did Kima's wire confirmation get filed?`,
    minutes(-200),
  );
  await mention(general.id, g3.id, "member", muhamad.id);

  const g4 = await send(general.id, muhamad.id, "Not yet, doing it today.", minutes(-198));
  await react(g4.id, raymond.id, "👍");

  const g5 = await send(
    general.id,
    muhamad.id,
    `please guys lets finish it ${mentionToken("task", lodestarTask.id, lodestarTask.title)}`,
    minutes(-197),
  );
  await mention(general.id, g5.id, "task", lodestarTask.id);
  await react(g5.id, raymond.id, "✅");
  await react(g5.id, rana.id, "👀");

  const g6 = await send(
    general.id,
    muhamad.id,
    `Great first-close signal from ${mentionToken("investor", clara.id, clara.fullName)} the $250k wire is in.`,
    minutes(-196),
  );
  await mention(general.id, g6.id, "investor", clara.id);

  const g7 = await send(general.id, raymond.id, "On it moving the overdue Lodestar signature check to the top of today's list.", minutes(-150));
  await react(g7.id, muhamad.id, "👍");

  const g8 = await send(
    general.id,
    rana.id,
    `I attached the closing receipt to ${mentionToken("deal", claraSeedDeal.id, clara.fullName)} so the wired allocation is documented.`,
    minutes(-100),
  );
  await mention(general.id, g8.id, "deal", claraSeedDeal.id);

  const g9 = await send(
    general.id,
    muhamad.id,
    `The ${mentionToken("round", seedRound.id, "Seed")} first close is complete; Sarah's diligence and Lodestar are the next priorities.`,
    minutes(-60),
  );
  await mention(general.id, g9.id, "round", seedRound.id);
  await react(g9.id, raymond.id, "🚀");

  const g10 = await send(general.id, muhamad.id, "Anyone free to join the Lodestar call this week and unblock the $600k soft circle?", minutes(-30));
  await send(general.id, raymond.id, "I can do Thursday afternoon.", minutes(-28), g10.id);
  const g10b = await send(general.id, rana.id, "I'll join too.", minutes(-25), g10.id);
  await prisma.message.update({ where: { id: g10.id }, data: { replyCount: 2 } });

  const g11 = await send(general.id, lopna.id, "Following along nice progress everyone!", minutes(-5));

  await join(general.id, [raymond.id, rana.id, lopna.id], g11.seq, g11.createdAt);
  // Muhamad was last active partway through the thread the last word (g11)
  // lands as this workspace's one unread badge in #general.
  await join(general.id, [muhamad.id], g10b.seq, g10b.createdAt);

  // ── #fundraising a smaller working group ─────────────────────────────────
  const fundraising = await prisma.conversation.create({
    data: {
      id: nextId(G.CONVERSATION),
      startupId: startup.id,
      type: "channel",
      name: "fundraising",
      topic: "Investor outreach, term sheets, closing logistics.",
      createdBy: muhamadUserId,
      lastMessageAt: minutes(-60),
    },
  });

  await send(fundraising.id, muhamad.id, "Syncing here on deal-specific stuff so #general stays clean.", minutes(-180));
  const f2 = await send(
    fundraising.id,
    raymond.id,
    `${mentionToken("deal", james.id, "James O'Brien")} confirmed for a partner meeting today.`,
    minutes(-120),
  );
  await mention(fundraising.id, f2.id, "deal", james.id);
  const f3 = await send(fundraising.id, rana.id, "Nice, I'll prep the intro deck.", minutes(-60));

  await join(fundraising.id, [muhamad.id, raymond.id, rana.id], f3.seq, f3.createdAt);

  // ── Muhamad ↔ Raymond DM left with an unread message on purpose, to
  //    demo the unread badge and the plain-DM notification together ────────
  const dm = await prisma.conversation.create({
    data: {
      id: nextId(G.CONVERSATION),
      startupId: startup.id,
      type: "dm",
      dmKey: [muhamad.id, raymond.id].sort().join(":"),
      createdBy: usersByKey.get("raymond")!.id,
      lastMessageAt: minutes(-8),
    },
  });

  await send(dm.id, raymond.id, "Hey got a sec to review the pre-seed vs seed comparison deck before EOD?", hours(-3));
  const dm2 = await send(dm.id, raymond.id, "No rush, just don't want it to slip.", minutes(-8));

  // Raymond's own sends advance his own read pointer; Muhamad hasn't opened
  // the DM yet, so both messages are still unread for him.
  await join(dm.id, [raymond.id], dm2.seq, dm2.createdAt);
  await join(dm.id, [muhamad.id], null, null);

  return { general, fundraising, dm, mentionMessageId: g3.id, dmLastMessageId: dm2.id };
}

// ─── Reviewer portal fixtures ──────────────────────────────────────────────────

/** sha256 hex, same as the local hashToken() in reviewer-invitation/portal services. */
const hashToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");

/**
 * A flat placeholder "page" WebP no rasterize worker actually runs during
 * seeding, so DocumentPage rows are written directly with the same shape the
 * worker would have produced for a real upload. Good enough to prove the
 * canvas viewer (Phase 1) renders something real for a seeded invitation.
 */
async function placeholderPage(
  width: number,
  height: number,
  label: string,
  pageNumber: number,
  accent: string,
): Promise<Buffer> {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff" />
      <rect width="100%" height="${Math.round(height * 0.05)}" fill="${accent}" />
      <text x="50%" y="50%" font-family="sans-serif" font-size="${Math.round(height / 14)}"
        fill="#1f2937" text-anchor="middle" dominant-baseline="middle">${label}</text>
      <text x="50%" y="${Math.round(height * 0.9)}" font-family="sans-serif" font-size="${Math.round(height / 28)}"
        fill="#6b7280" text-anchor="middle">Page ${pageNumber}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  // Deliberately local/demo only: wipe every application row, then rebuild the
  // whole deterministic dataset. Children are deleted explicitly so this stays
  // correct if a relation moves from cascade to restrict in a later migration.
  await prisma.$transaction(async (tx) => {
    await tx.aiChatMessage.deleteMany();
    await tx.aiChatSession.deleteMany();
    // Team chat content has a Restrict sender relation to StartupMember, so
    // remove the full child chain before removing workspace memberships.
    await tx.messageMention.deleteMany();
    await tx.message.deleteMany();
    await tx.conversationMember.deleteMany();
    await tx.conversation.deleteMany();
    await tx.personaQuestion.deleteMany();
    await tx.investorPersona.deleteMany();
    await tx.aiGapAnalysis.deleteMany();
    await tx.aiAnalysis.deleteMany();
    await tx.reviewerComment.deleteMany();
    await tx.reviewerPageView.deleteMany();
    await tx.reviewerVisit.deleteMany();
    await tx.reviewerEvent.deleteMany();
    await tx.reviewerSession.deleteMany();
    await tx.reviewerInvitationDocument.deleteMany();
    await tx.reviewerInvitation.deleteMany();
    await tx.documentPage.deleteMany();
    await tx.documentChunk.deleteMany();
    await tx.documentVersion.deleteMany();
    await tx.document.deleteMany();
    await tx.commitmentStatusEvent.deleteMany();
    await tx.commitment.deleteMany();
    await tx.task.deleteMany();
    await tx.interactionLog.deleteMany();
    await tx.pipelineStageEvent.deleteMany();
    await tx.pipeline.deleteMany();
    await tx.fundraisingRound.deleteMany();
    await tx.startupInvestor.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.notification.deleteMany();
    await tx.startupMember.deleteMany();
    await tx.rolePermission.deleteMany();
    await tx.role.deleteMany();
    await tx.passwordReset.deleteMany();
    // Auth middleware validates the session family on every request, so this
    // makes any browser cookies from before a reseed invalid immediately.
    await tx.refreshToken.updateMany({ data: { replacedById: null } });
    await tx.refreshToken.deleteMany();
    await tx.pendingRegistration.deleteMany();
    await tx.permission.deleteMany();
    await tx.user.updateMany({ data: { lastActiveStartupId: null } });
    await tx.startup.deleteMany();
    await tx.user.deleteMany();
  });

  // 1. Users one shared password so any account can be signed into quickly.
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const usersByKey = new Map<string, { id: string; firstName: string; lastName: string }>();

  for (const seed of USERS) {
    const isGoogle = seed.authProvider === "google";
    const user = await prisma.user.create({
      data: {
        id: nextId(G.USER),
        firstName: seed.firstName,
        lastName: seed.lastName,
        email: seed.email,
        // A Google account has no password the login route is expected to
        // answer GOOGLE_ACCOUNT rather than pretend the credentials are wrong.
        passwordHash: isGoogle ? null : passwordHash,
        authProvider: isGoogle ? "google" : "local",
        googleId: isGoogle ? `google-${seed.key}` : null,
        emailVerifiedAt: days(-200),
      },
    });
    usersByKey.set(seed.key, user);
  }

  // 2. Permissions global, shared by every workspace's roles.
  // skipDuplicates: a migration can also seed permission rows ahead of a
  // fresh `prisma migrate reset` (see 20260815150001_chat_permissions), so
  // this must tolerate rows that already exist rather than crash on the
  // (resource, action) unique constraint.
  await prisma.permission.createMany({ data: [...PERMISSIONS], skipDuplicates: true });
  const allPermissions = await prisma.permission.findMany();
  const permByKey = Object.fromEntries(allPermissions.map((p) => [`${p.resource}:${p.action}`, p]));

  // 3. Northbeam the workspace the demo opens on.
  const northbeam = await seedWorkspace(
    {
      id: uid(G.STARTUP, 1),
      name: "Northbeam",
      description: "Revenue intelligence for B2B sales teams.",
      industry: "SaaS",
      website: "https://northbeam.example.com",
      fundingStage: "seed",
      oneLiner: "Revenue intelligence that tells B2B sales teams which deals will actually close.",
      problemStatement:
        "Sales leaders find out a deal is slipping only after it's already lost forecast accuracy in most B2B orgs is under 60%.",
      solutionSummary:
        "Northbeam ingests CRM activity, call transcripts, and email threads to score deal health in real time and flag at-risk deals two to three weeks before they'd otherwise slip.",
      targetMarket: "Series A-C B2B SaaS companies with 10-100 person sales teams and a CRM already in place.",
      businessModel: "Per-seat SaaS subscription, billed annually, with usage-based add-ons for call intelligence minutes.",
      tractionSummary:
        "$100k MRR across 42 paying customers, 12% MoM growth this quarter, 96% logo retention, and 118% NRR.",
      competitiveEdge:
        "Purpose-built deal scoring model trained on our design partners' historical win/loss data, versus generic activity-count heuristics from incumbents.",
      headquarters: "New York, NY",
      foundedAt: new Date("2024-02-01T00:00:00.000Z"),
      teamSummary:
        "Founding team of three: CEO ex-Gong sales leader, CTO ex-Stripe infra, and a founding engineer ex-Amplitude data platform.",
      creatorKey: "muhamad",
      members: NORTHBEAM_MEMBERS,
      rounds: [
        {
          key: "pre_seed",
          roundName: "Pre-Seed",
          targetAmount: 200_000,
          minimumTicketSize: 25_000,
          equityOfferedPercentage: 7,
          currency: "USD",
          status: "closed",
          firstCloseInDays: -344,
          targetCloseInDays: -340,
        },
        {
          key: "seed",
          roundName: "Seed",
          targetAmount: 4_000_000,
          minimumTicketSize: 50_000,
          equityOfferedPercentage: 15,
          currency: "USD",
          status: "active",
          // Kima's $250k wire completed the first close two days ago. The
          // remaining story is lead diligence plus one at-risk soft circle.
          firstCloseInDays: -2,
          targetCloseInDays: 75,
        },
      ],
      contacts: NORTHBEAM_CONTACTS,
      tasks: NORTHBEAM_TASKS,
    },
    usersByKey,
    permByKey,
  );

  // 4. Drift Labs second workspace, EUR round, owner is only a collaborator.
  const drift = await seedWorkspace(
    {
      id: uid(G.STARTUP, 2),
      name: "Drift Labs",
      description: "Carbon accounting for logistics fleets.",
      industry: "Climate tech",
      website: "https://driftlabs.example.com",
      fundingStage: "seed",
      oneLiner: "Carbon accounting that plugs straight into fleet telematics, no manual reporting.",
      problemStatement:
        "Logistics fleets need Scope 1 emissions reports for compliance and shipper RFPs, but today that means someone manually stitching together fuel receipts and mileage logs.",
      solutionSummary:
        "Drift Labs connects directly to telematics providers and fuel cards to compute per-vehicle, per-route emissions automatically, with audit-ready exports.",
      targetMarket: "Mid-size European logistics and freight operators with 50-500 vehicle fleets.",
      businessModel: "Per-vehicle monthly SaaS fee plus a one-time telematics integration fee.",
      tractionSummary: "€19k MRR across 6 fleet customers, first two enterprise pilots converted to paid this quarter.",
      competitiveEdge: "Direct telematics integrations mean no manual data entry, versus spreadsheet-based competitors.",
      headquarters: "Lisbon, Portugal",
      foundedAt: new Date("2024-06-01T00:00:00.000Z"),
      teamSummary: "Two co-founders: CEO ex-logistics ops at a freight marketplace, CTO ex-climate data scientist.",
      creatorKey: "karim",
      members: DRIFT_MEMBERS,
      rounds: [
        {
          key: "seed_eur",
          roundName: "Seed",
          targetAmount: 2_000_000,
          minimumTicketSize: 50_000,
          equityOfferedPercentage: 12,
          // Non-USD on purpose: every amount on this workspace must render in
          // euros, which is what catches a hardcoded dollar sign.
          currency: "EUR",
          status: "active",
          targetCloseInDays: 120,
        },
      ],
      contacts: DRIFT_CONTACTS,
      tasks: DRIFT_TASKS,
    },
    usersByKey,
    permByKey,
  );

  const muhamad = usersByKey.get("muhamad")!;
  await prisma.user.update({
    where: { id: muhamad.id },
    data: { lastActiveStartupId: northbeam.startup.id },
  });

  // 5. Team chat Northbeam only, the workspace the demo opens on.
  const chat = await seedChat(
    northbeam.startup,
    northbeam.membersByKey,
    usersByKey,
    northbeam.contactsByKey,
    northbeam.dealsByKey,
    northbeam.roundsByKey,
    northbeam.tasksByKey,
  );

  // 6. A pending invitation the Team page's invited-but-not-joined state.
  await prisma.startupMember.create({
    data: {
      id: nextId(G.MEMBER),
      startupId: northbeam.startup.id,
      roleId: northbeam.roles.viewer.id,
      status: "pending",
      invitedEmail: "advisor@example.com",
      inviteTokenHash: "seed-pending-invite-token-hash",
      inviteExpiresAt: days(6),
      invitedBy: muhamad.id,
    },
  });

  // 7. Notifications one of every type the client knows how to render, with
  //    a mix of read and unread so the badge count is non-zero.
  const sarahDeal = northbeam.dealsByKey.get("sarah:seed")!;
  const owenDeal = northbeam.dealsByKey.get("owen:seed")!;
  const nadiaDeal = northbeam.dealsByKey.get("nadia:seed")!;
  const peterDeal = northbeam.dealsByKey.get("peter:seed")!;
  const sarahContact = northbeam.contactsByKey.get("sarah")!;

  const NOTIFICATIONS = [
    {
      type: "task_overdue",
      title: "Task overdue",
      body: "“Chase Lodestar on signature” was due yesterday.",
      entityType: "pipeline",
      entityId: owenDeal.id,
      readAt: null,
      createdAt: hours(-30),
    },
    {
      type: "task_due_today",
      title: "Task due today",
      body: "“Introduce Sarah to customer references” is due today.",
      entityType: "pipeline",
      entityId: sarahDeal.id,
      readAt: null,
      createdAt: hours(-8),
    },
    {
      type: "task_assigned",
      title: "New task assigned to you",
      body: "Raymond assigned you “Schedule Index founding-team intro”.",
      entityType: "pipeline",
      entityId: northbeam.dealsByKey.get("marcus:seed")!.id,
      readAt: null,
      createdAt: hours(-20),
    },
    {
      type: "lead_stale",
      title: "Lead has gone quiet",
      body: "Peter Lindqvist has had no new activity since his screening call two weeks ago.",
      entityType: "pipeline",
      entityId: peterDeal.id,
      readAt: null,
      createdAt: hours(-52),
    },
    {
      type: "deal_no_next_step",
      title: "Deal has no next step",
      body: "Nadia Rahman has no owner and no open task.",
      entityType: "pipeline",
      entityId: nadiaDeal.id,
      readAt: null,
      createdAt: hours(-60),
    },
    {
      type: "followup_due",
      title: "Follow-up due",
      body: "Lodestar VC's expected close date has passed without a signature.",
      entityType: "pipeline",
      entityId: owenDeal.id,
      readAt: hours(-2),
      createdAt: hours(-70),
    },
    {
      type: "team_invite",
      title: "You were added to Drift Labs",
      body: "Karim Baz added you as a collaborator.",
      entityType: "startup_member",
      entityId: drift.membersByKey.get("muhamad")!.id,
      readAt: hours(-96),
      createdAt: hours(-120),
    },
    {
      type: "chat_mention",
      title: "Rana Nemer mentioned you in #general",
      body: "Quick one @Muhamad Houda did Kima's wire confirmation get filed?",
      entityType: "conversation",
      entityId: chat.general.id,
      readAt: null,
      createdAt: minutes(-200),
    },
    {
      type: "direct_message",
      title: "Raymond Rached sent you a message",
      body: "No rush, just don't want it to slip.",
      entityType: "conversation",
      entityId: chat.dm.id,
      readAt: null,
      createdAt: minutes(-8),
    },
  ];

  for (const notification of NOTIFICATIONS) {
    await prisma.notification.create({
      data: {
        id: nextId(G.NOTIFICATION),
        startupId: northbeam.startup.id,
        userId: muhamad.id,
        ...notification,
    },
  });
  }

  // 8. Audit trail.
  const AUDITS = [
    {
      action: "create",
      entityType: "startup",
      entityId: northbeam.startup.id,
      changes: { name: "Northbeam", fundingStage: "seed" },
      createdAt: days(-420),
    },
    {
      action: "create",
      entityType: "round",
      entityId: northbeam.roundsByKey.get("seed")!.id,
      changes: { roundName: "Seed", targetAmount: 4_000_000, currency: "USD" },
      createdAt: days(-95),
    },
    {
      action: "update",
      entityType: "pipeline",
      entityId: sarahDeal.id,
      changes: { stage: { from: "meeting_scheduled", to: "due_diligence" } },
      createdAt: days(-10),
    },
    {
      action: "update",
      entityType: "pipeline",
      entityId: sarahDeal.id,
      changes: { isLead: { from: false, to: true } },
      createdAt: days(-10),
    },
    {
      action: "create",
      entityType: "investor",
      entityId: sarahContact.id,
      changes: { fullName: sarahContact.fullName, ventureFirm: sarahContact.ventureFirm },
      createdAt: days(-72),
    },
  ];

  for (const audit of AUDITS) {
    await prisma.auditLog.create({
      data: {
        id: nextId(G.AUDIT),
        startupId: northbeam.startup.id,
        userId: muhamad.id,
        ipAddress: "127.0.0.1",
        ...audit,
      },
    });
  }

  // 8. Ready data-room documents (TXT so parse works without LlamaParse).
  const DOCUMENTS = [
    {
      title: "Northbeam Seed Pitch Overview",
      documentType: "pitch_deck",
      filename: "northbeam-seed-pitch.txt",
      content: `# Northbeam Seed Pitch

## Problem
B2B revenue teams drown in fragmented attribution data.

## Solution
Northbeam unifies pipeline signal so founders and AEs prioritize the right accounts.

## Traction
- $1.2M ARR
- 42 customers
- Net revenue retention 118%

## The Ask
Raising a $4M seed to expand GTM and deepen product coverage.
`,
    },
    {
      title: "Cap Table Summary",
      documentType: "cap_table",
      filename: "northbeam-cap-table.txt",
      content: `# Cap Table Summary

| Holder | Ownership |
| --- | --- |
| Founders | 73% |
| Employees (option pool) | 15% |
| Pre-Seed investors | 7% |
| Advisors | 5% |

Notes: figures are illustrative seed data for local demos.
`,
    },
  ] as const;

  let documentCount = 0;
  for (const docSeed of DOCUMENTS) {
    documentCount += 1;
    const documentId = uid(G.DOCUMENT, documentCount);
    const versionId = uid(G.DOCUMENT_VERSION, documentCount);
    const storageKey = `startups/${northbeam.startup.id}/documents/${documentId}/${versionId}/${docSeed.filename}`;
    const fullPath = path.resolve(process.cwd(), ".uploads", storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const buffer = Buffer.from(docSeed.content, "utf8");
    await fs.writeFile(fullPath, buffer);

    await prisma.document.create({
      data: {
        id: documentId,
        startupId: northbeam.startup.id,
        title: docSeed.title,
        documentType: docSeed.documentType,
        createdBy: muhamad.id,
        versions: {
          create: {
            id: versionId,
            versionNumber: 1,
            isCurrent: true,
            storageProvider: "local",
            storageKey,
            mimeType: "text/plain",
            originalFilename: docSeed.filename,
            fileSize: buffer.length,
            processingStatus: "ready",
            summary: "Seeded demo document",
            uploadedBy: muhamad.id,
            chunks: {
              create: {
                id: uid(G.DOCUMENT_CHUNK, documentCount),
                chunkIndex: 0,
                content: docSeed.content.trim(),
                tokenCount: Math.ceil(docSeed.content.length / 4),
                sectionLabel: "Overview",
                charStart: 0,
                charEnd: docSeed.content.trim().length,
              },
            },
          },
        },
      },
    });
  }

  // 9. A rendered PDF and a "converted" PPTX so the secure reviewer viewer has
  //    real pages to show. No rasterize worker actually runs during seeding —
  //    DocumentPage rows are written directly with placeholder WebP tiles,
  //    exactly the shape the worker would have produced for a real upload
  //    (the PPTX row simulates what Phase 5's LibreOffice conversion leaves
  //    behind: renderStatus "ready" with no trace of the original format).
  async function seedRenderedDocument(spec: {
    title: string;
    documentType: string;
    filename: string;
    mimeType: string;
    pageSize: { width: number; height: number };
    pageCount: number;
    accent: string;
  }) {
    documentCount += 1;
    const documentId = uid(G.DOCUMENT, documentCount);
    const versionId = uid(G.DOCUMENT_VERSION, documentCount);
    const prefix = `startups/${northbeam.startup.id}/documents/${documentId}/${versionId}`;
    const sourceKey = `${prefix}/${spec.filename}`;

    // The reviewer portal never opens the source file (that's the point of
    // Phase 1) — a small stand-in is enough for it to exist on disk for
    // allowDownload invitations, and for the founder's own Documents page.
    const sourceBuffer = Buffer.from(`Seed placeholder for ${spec.title}`, "utf8");
    const sourcePath = path.resolve(process.cwd(), ".uploads", sourceKey);
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, sourceBuffer);

    await prisma.document.create({
      data: {
        id: documentId,
        startupId: northbeam.startup.id,
        title: spec.title,
        documentType: spec.documentType,
        createdBy: muhamad.id,
        versions: {
          create: {
            id: versionId,
            versionNumber: 1,
            isCurrent: true,
            storageProvider: "local",
            storageKey: sourceKey,
            mimeType: spec.mimeType,
            originalFilename: spec.filename,
            fileSize: sourceBuffer.length,
            processingStatus: "ready",
            renderStatus: "ready",
            pageCount: spec.pageCount,
            summary: "Seeded demo document",
            uploadedBy: muhamad.id,
          },
        },
      },
    });

    for (let pageNumber = 1; pageNumber <= spec.pageCount; pageNumber++) {
      const view = await placeholderPage(
        spec.pageSize.width,
        spec.pageSize.height,
        spec.title,
        pageNumber,
        spec.accent,
      );
      const thumbHeight = Math.round((spec.pageSize.height / spec.pageSize.width) * 220);
      const thumb = await placeholderPage(220, thumbHeight, spec.title, pageNumber, spec.accent);

      const storageKey = `${prefix}/pages/${pageNumber}.webp`;
      const thumbStorageKey = `${prefix}/thumbs/${pageNumber}.webp`;
      const pagePath = path.resolve(process.cwd(), ".uploads", storageKey);
      const thumbPath = path.resolve(process.cwd(), ".uploads", thumbStorageKey);
      await fs.mkdir(path.dirname(pagePath), { recursive: true });
      await fs.mkdir(path.dirname(thumbPath), { recursive: true });
      await fs.writeFile(pagePath, view);
      await fs.writeFile(thumbPath, thumb);

      await prisma.documentPage.create({
        data: {
          documentVersionId: versionId,
          pageNumber,
          width: spec.pageSize.width,
          height: spec.pageSize.height,
          storageKey,
          thumbStorageKey,
          storageProvider: "local",
          byteSize: view.length,
        },
      });
    }

    return { documentId, versionId, pageCount: spec.pageCount };
  }

  const deckDoc = await seedRenderedDocument({
    title: "Northbeam Series Seed Deck",
    documentType: "pitch_deck",
    filename: "northbeam-seed-deck.pdf",
    mimeType: "application/pdf",
    pageSize: { width: 1600, height: 900 },
    pageCount: 4,
    accent: "#4f46e5",
  });
  const teaserDoc = await seedRenderedDocument({
    title: "Northbeam Product Teaser",
    documentType: "other",
    filename: "northbeam-product-teaser.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pageSize: { width: 1600, height: 900 },
    pageCount: 2,
    accent: "#0d9488",
  });

  // 10. Reviewer invitations exercising every link control from Phases 1-5:
  //     rendered pages to view, watermarking, download/print/screenshot
  //     policy, an NDA gate, a password-protected link, and forwarding
  //     detection (two sessions from different devices on the same invite).
  const reviewerPassword = "Reviewer1234!";
  const reviewerPasswordHash = await hashPassword(reviewerPassword);
  const sarahReviewerContact = northbeam.contactsByKey.get("sarah")!;
  const elenaReviewerContact = northbeam.contactsByKey.get("elena")!;
  const hiroshiReviewerContact = northbeam.contactsByKey.get("hiroshi")!;

  async function createInvitation(input: {
    key: string;
    reviewerName: string;
    email: string;
    startupInvestorId?: string;
    status: string;
    createdAt: Date;
    expiresAt: Date;
    revokedAt?: Date;
    lastActivityAt?: Date;
    allowDownload?: boolean;
    watermarkEnabled?: boolean;
    notifyOnOpen?: boolean;
    allowPrint?: boolean;
    screenshotGuard?: boolean;
    requireNda?: boolean;
    ndaAcceptedAt?: Date;
    passwordHash?: string;
    allowedEmailDomains?: string[];
    documents: Array<{ documentId: string; versionId: string }>;
  }) {
    return prisma.reviewerInvitation.create({
      data: {
        id: nextId(G.REVIEWER_INVITATION),
        startupId: northbeam.startup.id,
        startupInvestorId: input.startupInvestorId,
        reviewerName: input.reviewerName,
        emailNormalized: input.email,
        tokenHash: hashToken(`seed-token-${input.key}`),
        status: input.status,
        allowDownload: input.allowDownload ?? false,
        watermarkEnabled: input.watermarkEnabled ?? true,
        notifyOnOpen: input.notifyOnOpen ?? true,
        allowPrint: input.allowPrint ?? false,
        screenshotGuard: input.screenshotGuard ?? true,
        requireNda: input.requireNda ?? false,
        ndaText: input.requireNda ? renderReviewerNda(northbeam.startup.name) : undefined,
        ndaAcceptedAt: input.ndaAcceptedAt,
        passwordHash: input.passwordHash,
        allowedEmailDomains: input.allowedEmailDomains ?? [],
        expiresAt: input.expiresAt,
        revokedAt: input.revokedAt,
        lastActivityAt: input.lastActivityAt,
        createdBy: muhamad.id,
        createdAt: input.createdAt,
        documents: {
          create: input.documents.map((doc, index) => ({
            id: nextId(G.REVIEWER_INVITATION_DOCUMENT),
            documentId: doc.documentId,
            documentVersionId: doc.versionId,
            displayOrder: index,
            addedBy: muhamad.id,
            addedAt: input.createdAt,
          })),
        },
      },
    });
  }

  async function createVerifiedSession(input: {
    invitationId: string;
    ip: string;
    userAgent: string;
    verifiedAt: Date;
    accessedAt: Date;
    expiresAt: Date;
  }) {
    return prisma.reviewerSession.create({
      data: {
        invitationId: input.invitationId,
        sessionTokenHash: hashToken(`seed-session-${input.invitationId}-${input.ip}`),
        verifiedAt: input.verifiedAt,
        accessedAt: input.accessedAt,
        expiresAt: input.expiresAt,
        ipAddress: input.ip,
        userAgent: input.userAgent,
      },
    });
  }

  async function createVisitWithPageViews(input: {
    invitationId: string;
    sessionId: string;
    startedAt: Date;
    lastSeenAt: Date;
    deviceType: string;
    os: string;
    browser: string;
    deviceHash: string;
    ipHash: string;
    suspectedForward?: boolean;
    totalPages: number;
    pages: Array<{ versionId: string; pageNumber: number; activeMs: number }>;
  }) {
    const visit = await prisma.reviewerVisit.create({
      data: {
        startupId: northbeam.startup.id,
        invitationId: input.invitationId,
        sessionId: input.sessionId,
        startedAt: input.startedAt,
        lastSeenAt: input.lastSeenAt,
        deviceType: input.deviceType,
        os: input.os,
        browser: input.browser,
        deviceHash: input.deviceHash,
        ipHash: input.ipHash,
        suspectedForward: input.suspectedForward ?? false,
        pagesViewed: input.pages.length,
        maxPageReached: Math.max(...input.pages.map((p) => p.pageNumber)),
        totalActiveMs: input.pages.reduce((sum, p) => sum + p.activeMs, 0),
        completionPct: Math.round((input.pages.length / input.totalPages) * 100),
      },
    });

    for (const page of input.pages) {
      await prisma.reviewerPageView.create({
        data: {
          visitId: visit.id,
          documentVersionId: page.versionId,
          pageNumber: page.pageNumber,
          firstViewedAt: input.startedAt,
          lastViewedAt: input.lastSeenAt,
          activeMs: page.activeMs,
        },
      });
    }

    return visit;
  }

  async function createReviewerEvent(input: {
    invitationId: string;
    sessionId: string;
    type: string;
    documentVersionId?: string;
    pageNumber?: number;
    metadata?: object;
    createdAt: Date;
  }) {
    return prisma.reviewerEvent.create({
      data: {
        startupId: northbeam.startup.id,
        invitationId: input.invitationId,
        sessionId: input.sessionId,
        type: input.type,
        documentVersionId: input.documentVersionId,
        pageNumber: input.pageNumber,
        metadata: input.metadata,
        createdAt: input.createdAt,
      },
    });
  }

  // 10a. Sarah Chen (Sequoia) — the flagship row: in review, download +
  // watermark on, opened from two different devices a week apart, which
  // trips the forwarding signal the same way recordTelemetry does live.
  const sarahInvitation = await createInvitation({
    key: "sarah-in-review",
    reviewerName: sarahReviewerContact.fullName,
    email: "sarah.chen@sequoiacap.example.com",
    startupInvestorId: sarahReviewerContact.id,
    status: "in_review",
    createdAt: days(-6),
    expiresAt: days(8),
    lastActivityAt: days(-3),
    allowDownload: true,
    watermarkEnabled: true,
    notifyOnOpen: true,
    allowPrint: false,
    screenshotGuard: true,
    documents: [
      { documentId: deckDoc.documentId, versionId: deckDoc.versionId },
      { documentId: teaserDoc.documentId, versionId: teaserDoc.versionId },
    ],
  });

  const sarahSessionMac = await createVerifiedSession({
    invitationId: sarahInvitation.id,
    ip: "203.0.113.10",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
    verifiedAt: days(-6),
    accessedAt: days(-5.7),
    expiresAt: hours(2),
  });
  await createVisitWithPageViews({
    invitationId: sarahInvitation.id,
    sessionId: sarahSessionMac.id,
    startedAt: days(-6),
    lastSeenAt: days(-5.7),
    deviceType: "desktop",
    os: "macOS",
    browser: "Chrome",
    deviceHash: hashToken("seed-device-sarah-macbook"),
    ipHash: hashToken("seed-ip-sarah-office"),
    suspectedForward: true,
    totalPages: deckDoc.pageCount,
    pages: [
      { versionId: deckDoc.versionId, pageNumber: 1, activeMs: 42_000 },
      { versionId: deckDoc.versionId, pageNumber: 2, activeMs: 38_000 },
      { versionId: deckDoc.versionId, pageNumber: 3, activeMs: 51_000 },
      { versionId: deckDoc.versionId, pageNumber: 4, activeMs: 12_000 },
    ],
  });
  await createReviewerEvent({
    invitationId: sarahInvitation.id,
    sessionId: sarahSessionMac.id,
    type: "copy_attempt",
    documentVersionId: deckDoc.versionId,
    pageNumber: 2,
    createdAt: days(-5.9),
  });
  await createReviewerEvent({
    invitationId: sarahInvitation.id,
    sessionId: sarahSessionMac.id,
    type: "print_attempt",
    documentVersionId: deckDoc.versionId,
    createdAt: days(-5.8),
  });
  await createReviewerEvent({
    invitationId: sarahInvitation.id,
    sessionId: sarahSessionMac.id,
    type: "download_completed",
    documentVersionId: deckDoc.versionId,
    createdAt: days(-5.7),
  });

  const sarahSessionIphone = await createVerifiedSession({
    invitationId: sarahInvitation.id,
    ip: "198.51.100.42",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    verifiedAt: days(-3),
    accessedAt: days(-3),
    expiresAt: hours(6),
  });
  await createVisitWithPageViews({
    invitationId: sarahInvitation.id,
    sessionId: sarahSessionIphone.id,
    startedAt: days(-3),
    lastSeenAt: days(-2.95),
    deviceType: "mobile",
    os: "iOS",
    browser: "Safari",
    deviceHash: hashToken("seed-device-sarah-iphone"),
    ipHash: hashToken("seed-ip-sarah-mobile"),
    suspectedForward: true,
    totalPages: deckDoc.pageCount,
    pages: [
      { versionId: deckDoc.versionId, pageNumber: 1, activeMs: 15_000 },
      { versionId: deckDoc.versionId, pageNumber: 2, activeMs: 9_000 },
    ],
  });
  await createReviewerEvent({
    invitationId: sarahInvitation.id,
    sessionId: sarahSessionIphone.id,
    type: "screenshot_attempt",
    documentVersionId: deckDoc.versionId,
    pageNumber: 1,
    createdAt: days(-2.98),
  });
  await createReviewerEvent({
    invitationId: sarahInvitation.id,
    sessionId: sarahSessionIphone.id,
    type: "forward_suspected",
    metadata: { distinctDevices: 2, distinctIps: 2 },
    createdAt: days(-3),
  });

  // 10b. Elena Fischer (Balderton) — NDA required and already accepted;
  // printing is allowed for this link, screenshots still guarded.
  const elenaNdaAcceptedAt = days(-2);
  const elenaInvitation = await createInvitation({
    key: "elena-nda",
    reviewerName: elenaReviewerContact.fullName,
    email: "elena.fischer@balderton.example.com",
    startupInvestorId: elenaReviewerContact.id,
    status: "opened",
    createdAt: days(-4),
    expiresAt: days(10),
    lastActivityAt: elenaNdaAcceptedAt,
    allowDownload: false,
    watermarkEnabled: true,
    notifyOnOpen: true,
    allowPrint: true,
    screenshotGuard: true,
    requireNda: true,
    ndaAcceptedAt: elenaNdaAcceptedAt,
    documents: [{ documentId: deckDoc.documentId, versionId: deckDoc.versionId }],
  });
  const elenaSession = await createVerifiedSession({
    invitationId: elenaInvitation.id,
    ip: "192.0.2.77",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/124.0",
    verifiedAt: days(-4),
    accessedAt: elenaNdaAcceptedAt,
    expiresAt: hours(4),
  });
  await createReviewerEvent({
    invitationId: elenaInvitation.id,
    sessionId: elenaSession.id,
    type: "nda_accepted",
    createdAt: elenaNdaAcceptedAt,
  });
  await createVisitWithPageViews({
    invitationId: elenaInvitation.id,
    sessionId: elenaSession.id,
    startedAt: elenaNdaAcceptedAt,
    lastSeenAt: days(-1.9),
    deviceType: "desktop",
    os: "Windows",
    browser: "Edge",
    deviceHash: hashToken("seed-device-elena-laptop"),
    ipHash: hashToken("seed-ip-elena"),
    totalPages: deckDoc.pageCount,
    pages: [
      { versionId: deckDoc.versionId, pageNumber: 1, activeMs: 20_000 },
      { versionId: deckDoc.versionId, pageNumber: 2, activeMs: 18_000 },
    ],
  });

  // 10c. Hiroshi Sato (Global Brain) — access revoked before he opened it.
  await createInvitation({
    key: "hiroshi-revoked",
    reviewerName: hiroshiReviewerContact.fullName,
    email: "h.sato@globalbrain.example.com",
    startupInvestorId: hiroshiReviewerContact.id,
    status: "revoked",
    createdAt: days(-10),
    expiresAt: days(4),
    revokedAt: days(-1),
    allowDownload: false,
    notifyOnOpen: false,
    documents: [{ documentId: deckDoc.documentId, versionId: deckDoc.versionId }],
  });

  // 10d. A password-protected link for a corp-dev contact outside the CRM,
  // restricted to their company's email domain, never opened yet — exercises
  // the "pending" empty state in the Reviewers list and Analytics sheet.
  await createInvitation({
    key: "marcus-pending",
    reviewerName: "Marcus Webb",
    email: "marcus.webb@bigcorp.example.com",
    status: "pending",
    createdAt: days(-1),
    expiresAt: days(13),
    allowDownload: false,
    passwordHash: reviewerPasswordHash,
    allowedEmailDomains: ["bigcorp.example"],
    documents: [{ documentId: teaserDoc.documentId, versionId: teaserDoc.versionId }],
  });

  const totalContacts = NORTHBEAM_CONTACTS.length + DRIFT_CONTACTS.length;

  console.info("─── Seed complete ───────────────────────────────────────");
  console.info(`  Sign in:       muhamad.houda@gmail.com / ${DEMO_PASSWORD}`);
  console.info(`  Team:          ${USERS.length} users · 1 pending invite`);
  console.info("                 raymond + rana collaborators, lopna viewer");
  console.info("                 rana is Google-only (no password)");
  console.info(`  Workspaces:    Northbeam (owner) · Drift Labs (collaborator)`);
  console.info(`  Permissions:   ${PERMISSIONS.length} entries × 3 roles × 2 workspaces`);
  console.info(`  Rounds:        Seed $4M active · Pre-Seed $200k closed · Drift €2M active`);
  console.info(`  Contacts:      ${totalContacts}`);
  console.info(
    `  Deals:         ${northbeam.counts.dealCount + drift.counts.dealCount} across every stage, with full stage history`,
  );
  console.info(
    `  Commitments:   ${northbeam.counts.commitmentCount + drift.counts.commitmentCount} (soft · hard · wired · withdrawn) with status history`,
  );
  console.info(
    `  Tasks:         ${northbeam.counts.taskCount + drift.counts.taskCount} (overdue · today · upcoming · unassigned · done)`,
  );
  console.info(
    `  Interactions:  ${northbeam.counts.logCount + drift.counts.logCount} logs across call/email/meeting/note/other`,
  );
  console.info(`  Chat:          #general + #fundraising, a DM with Raymond (unread), reactions + a reply thread`);
  console.info(`  Notifications: ${NOTIFICATIONS.length} (7 unread)`);
  console.info(`  Audit logs:    ${AUDITS.length} entries`);
  console.info(`  Documents:     ${documentCount} in data room (2 TXT, 1 rendered PDF, 1 rendered PPTX)`);
  console.info(
    "  Reviewers:     4 invitations — in-review w/ forwarding flagged, NDA-gated, revoked, password-protected pending",
  );
  console.info(`                 password link: ${reviewerPassword}`);
  console.info("─────────────────────────────────────────────────────────");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
