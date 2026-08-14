import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/auth";
import { PERMISSIONS, ROLE_TEMPLATES } from "../src/config/permissions";
import type { InvestorType, PipelineStage, Priority } from "../src/config/crm";

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────

// Typed against the shared CRM vocabularies so a typo in a stage or investor
// type fails the build instead of seeding an unrenderable row.
interface ContactSeed {
  id: string;
  fullName: string;
  email?: string;
  ventureFirm?: string;
  investorType: InvestorType;
  sectorFocus?: string;
  investmentStagePreference?: string;
  linkedinUrl?: string;
  notes?: string;
  source?: string;
  pipeline?: {
    id: string;
    stage: PipelineStage;
    expectedAmount?: number;
    probabilityPercentage?: number;
    priority?: Priority;
    investorFitScore?: number;
    /** Assigns the founder as this deal's owner. */
    ownedByFounder?: boolean;
  };
  /** Days from now for the next follow-up; omit for contacts with none due. */
  followupInDays?: number;
}

/** Derives the demo follow-up interaction id from a contact id. */
const followupLogId = (contactId: string): string => `0000ff00${contactId.slice(8)}`;

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  // This command is deliberately for local/demo environments: it removes every
  // application row, then recreates the complete deterministic demo dataset.
  // Delete children explicitly so this remains correct if a relation changes
  // from cascade to restrict in a future schema migration.
  await prisma.$transaction(async (tx) => {
    await tx.aiChatMessage.deleteMany();
    await tx.aiChatSession.deleteMany();
    await tx.personaQuestion.deleteMany();
    await tx.investorPersona.deleteMany();
    await tx.aiGapAnalysis.deleteMany();
    await tx.aiAnalysis.deleteMany();
    await tx.reviewerComment.deleteMany();
    await tx.reviewerSession.deleteMany();
    await tx.reviewerInvitationDocument.deleteMany();
    await tx.reviewerInvitation.deleteMany();
    await tx.documentChunk.deleteMany();
    await tx.documentVersion.deleteMany();
    await tx.document.deleteMany();
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
    await tx.refreshToken.updateMany({ data: { replacedById: null } });
    await tx.refreshToken.deleteMany();
    await tx.pendingRegistration.deleteMany();
    await tx.permission.deleteMany();
    await tx.user.updateMany({ data: { lastActiveStartupId: null } });
    await tx.startup.deleteMany();
    await tx.user.deleteMany();
  });

  // 1. Founder user
  const passwordHash = await hashPassword("Founder1234!");

  const founder = await prisma.user.create({
    data: {
      id: "00000000-0000-0000-0000-000000000001",
      firstName: "Jane",
      lastName: "Doe",
      email: "founder@example.com",
      passwordHash,
      authProvider: "local",
      emailVerifiedAt: new Date(),
    },
  });

  // 2. Startup
  const startup = await prisma.startup.create({
    data: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Acme Corp",
      description: "AI-powered fundraising platform for early-stage startups.",
      industry: "SaaS",
      website: "https://acmecorp.example.com",
      fundingStage: "pre_seed",
      createdBy: founder.id,
    },
  });

  // Link founder's last active workspace
  await prisma.user.update({
    where: { id: founder.id },
    data: { lastActiveStartupId: startup.id },
  });

  // 3. Permissions
  await prisma.permission.createMany({ data: PERMISSIONS });

  const allPermissions = await prisma.permission.findMany();

  // 4. System roles
  const ownerRole = await prisma.role.create({
    data: {
      id: "00000000-0000-0000-0000-000000000010",
      startupId: startup.id,
      name: "owner",
      description: "Full access to all resources",
      isSystemRole: true,
    },
  });

  const collaboratorRole = await prisma.role.create({
    data: {
      id: "00000000-0000-0000-0000-000000000011",
      startupId: startup.id,
      name: "collaborator",
      description: "Can edit pipeline and documents, no billing access",
      isSystemRole: true,
    },
  });

  const viewerRole = await prisma.role.create({
    data: {
      id: "00000000-0000-0000-0000-000000000012",
      startupId: startup.id,
      name: "viewer",
      description: "Read-only access",
      isSystemRole: true,
    },
  });

  // 5. Role ↔ permission assignments
  const permByKey = Object.fromEntries(allPermissions.map((p) => [`${p.resource}:${p.action}`, p]));

  const roleAssignments: Array<{ role: typeof ownerRole; keys: string[] }> = [
    { role: ownerRole, keys: ROLE_TEMPLATES.owner },
    { role: collaboratorRole, keys: ROLE_TEMPLATES.collaborator },
    { role: viewerRole, keys: ROLE_TEMPLATES.viewer },
  ];

  for (const { role, keys } of roleAssignments) {
    for (const key of keys) {
      const perm = permByKey[key];
      if (!perm) continue;
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
  }

  // 6. Founder as owner member
  const founderMember = await prisma.startupMember.create({
    data: {
      startupId: startup.id,
      userId: founder.id,
      roleId: ownerRole.id,
      status: "active",
      joinedAt: new Date(),
    },
  });

  // 7. Investor contacts — private to this startup. The roster deliberately
  //    covers every investorType, most pipeline stages, and the nullable cases
  //    the Investors screen has to render: a contact with no pipeline entry, and
  //    one with no email.
  const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1_000);

  const CONTACTS: ContactSeed[] = [
    {
      id: "00000000-0000-0000-0000-000000000020",
      fullName: "Sarah Chen",
      email: "sarah.chen@sequoiacap.example.com",
      ventureFirm: "Sequoia Capital",
      investorType: "vc",
      sectorFocus: "SaaS, AI",
      investmentStagePreference: "seed",
      linkedinUrl: "https://linkedin.com/in/sarahchen",
      notes: "Met at TechCrunch Disrupt. Very interested in our GTM strategy.",
      source: "event",
      // Keeps the original id — the fundraising round's commitment and an audit
      // log already point at this contact and its pipeline entry.
      pipeline: {
        id: "00000000-0000-0000-0000-000000000030",
        stage: "due_diligence",
        expectedAmount: 2_500_000,
        probabilityPercentage: 70,
        priority: "high",
        investorFitScore: 85,
        ownedByFounder: true,
      },
      followupInDays: 5,
    },
    {
      id: "00000000-0000-0000-0000-000000000021",
      fullName: "Marcus Webb",
      email: "marcus.webb@indexventures.example.com",
      ventureFirm: "Index Ventures",
      investorType: "vc",
      sectorFocus: "Developer tools",
      investmentStagePreference: "seed",
      notes: "Second call went well. Wants to meet the full founding team.",
      source: "warm_intro",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000061",
        stage: "meeting_scheduled",
        expectedAmount: 1_500_000,
        probabilityPercentage: 50,
        priority: "medium",
        ownedByFounder: true,
      },
      followupInDays: 3,
    },
    {
      id: "00000000-0000-0000-0000-000000000022",
      fullName: "Priya Anand",
      email: "priya.anand@example.com",
      investorType: "angel",
      sectorFocus: "Fintech, SaaS",
      investmentStagePreference: "pre_seed",
      notes: "Former operator. Committed on the spot after the demo.",
      source: "referral",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000062",
        stage: "committed",
        expectedAmount: 250_000,
        probabilityPercentage: 100,
      },
    },
    {
      id: "00000000-0000-0000-0000-000000000023",
      fullName: "James O'Brien",
      email: "james.obrien@accel.example.com",
      ventureFirm: "Accel",
      investorType: "vc",
      sectorFocus: "B2B SaaS",
      investmentStagePreference: "series_a",
      notes: "Replied to cold outreach. Asked for the deck and metrics.",
      source: "outbound",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000063",
        stage: "contacted",
        expectedAmount: 2_000_000,
        probabilityPercentage: 30,
      },
      followupInDays: 7,
    },
    {
      id: "00000000-0000-0000-0000-000000000024",
      fullName: "Lena Park",
      email: "lena.park@lightspeed.example.com",
      ventureFirm: "Lightspeed",
      investorType: "vc",
      sectorFocus: "Infrastructure",
      investmentStagePreference: "series_a",
      source: "conference",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000064",
        stage: "sourced",
        expectedAmount: 3_000_000,
        probabilityPercentage: 15,
      },
    },
    {
      id: "00000000-0000-0000-0000-000000000025",
      fullName: "Dmitri Volkov",
      email: "dmitri@volkovfamily.example.com",
      ventureFirm: "Volkov Family Office",
      investorType: "family_office",
      sectorFocus: "Diversified",
      notes: "Requested the data room. Legal review underway.",
      source: "referral",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000065",
        stage: "due_diligence",
        expectedAmount: 500_000,
        probabilityPercentage: 60,
      },
      followupInDays: 9,
    },
    {
      id: "00000000-0000-0000-0000-000000000026",
      fullName: "Aisha Mensah",
      email: "aisha.mensah@yc.example.com",
      ventureFirm: "Y Combinator",
      investorType: "accelerator",
      investmentStagePreference: "pre_seed",
      notes: "Standard deal. Paperwork signed.",
      source: "program",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000066",
        stage: "committed",
        expectedAmount: 500_000,
        probabilityPercentage: 100,
      },
    },
    {
      id: "00000000-0000-0000-0000-000000000027",
      fullName: "Tom Reilly",
      email: "tom.reilly@example.com",
      investorType: "angel",
      sectorFocus: "Marketplaces",
      source: "linkedin",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000067",
        stage: "contacted",
        expectedAmount: 100_000,
        probabilityPercentage: 40,
      },
      followupInDays: 4,
    },
    {
      id: "00000000-0000-0000-0000-000000000028",
      fullName: "Nora Holm",
      email: "nora.holm@northzone.example.com",
      ventureFirm: "Northzone",
      investorType: "vc",
      investmentStagePreference: "seed",
      source: "outbound",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000068",
        stage: "sourced",
        expectedAmount: 1_800_000,
        probabilityPercentage: 10,
      },
    },
    {
      id: "00000000-0000-0000-0000-000000000029",
      fullName: "Victor Alvarez",
      email: "victor.alvarez@bessemer.example.com",
      ventureFirm: "Bessemer",
      investorType: "vc",
      notes: "Passed — too early for their current fund.",
      source: "outbound",
      pipeline: {
        id: "00000000-0000-0000-0000-000000000069",
        stage: "passed",
        probabilityPercentage: 0,
      },
    },
    {
      // No email and no pipeline entry — exercises both nullable paths in the
      // list response (unique email is only enforced on non-null values).
      id: "0000000a-0000-0000-0000-00000000002a",
      fullName: "Yuki Tanaka",
      investorType: "other",
      notes: "Met briefly at a meetup — no contact details yet.",
      source: "event",
    },
    // Off-pipeline contacts — available in "Add to pipeline" (old UI roster).
    {
      id: "00000000-0000-0000-0000-000000000040",
      fullName: "Amara Chen",
      email: "amara@atlasvc.com",
      ventureFirm: "Atlas Ventures",
      investorType: "vc",
      sectorFocus: "AI / Infrastructure",
      investmentStagePreference: "seed",
      notes: "Warm intro from a founder in the portfolio.",
      source: "referral",
    },
    {
      id: "00000000-0000-0000-0000-000000000041",
      fullName: "Daniel Okafor",
      email: "d.okafor@northwind.capital",
      ventureFirm: "Northwind Capital",
      investorType: "vc",
      sectorFocus: "B2B SaaS",
      investmentStagePreference: "seed",
      source: "outbound",
    },
    {
      id: "00000000-0000-0000-0000-000000000042",
      fullName: "Sofia Marino",
      email: "sofia@harborangels.com",
      ventureFirm: "Harbor Angels",
      investorType: "angel",
      sectorFocus: "Marketplaces",
      investmentStagePreference: "pre_seed",
      source: "event",
    },
    {
      id: "00000000-0000-0000-0000-000000000043",
      fullName: "Ethan Brooks",
      email: "ethan@quantleap.fund",
      ventureFirm: "Quantleap Fund",
      investorType: "vc",
      sectorFocus: "AI / Infrastructure",
      investmentStagePreference: "series_a",
      source: "linkedin",
    },
    {
      id: "00000000-0000-0000-0000-000000000044",
      fullName: "Grace Lin",
      email: "grace@vertexcollective.com",
      ventureFirm: "Vertex Collective",
      investorType: "vc",
      sectorFocus: "Fintech",
      investmentStagePreference: "seed",
      source: "conference",
    },
    {
      id: "00000000-0000-0000-0000-000000000045",
      fullName: "Owen Wright",
      email: "owen@lodestar.vc",
      ventureFirm: "Lodestar VC",
      investorType: "vc",
      sectorFocus: "Climate",
      investmentStagePreference: "series_a",
      source: "outbound",
    },
  ];

  // The pipeline belongs to this active raise. Create it before pipeline rows.
  const round = await prisma.fundraisingRound.create({
    data: {
      id: "00000000-0000-0000-0000-000000000031",
      startupId: startup.id,
      roundName: "Pre-Seed",
      targetAmount: 500000,
      minimumTicketSize: 25000,
      equityOfferedPercentage: 10,
      currency: "USD",
      status: "active",
    },
  });

  const contactsById = new Map<string, { id: string; fullName: string; ventureFirm: string | null }>();
  const pipelinesById = new Map<string, { id: string }>();

  for (const seed of CONTACTS) {
    const { pipeline: pipelineSeed, followupInDays, ...contactFields } = seed;

    const contact = await prisma.startupInvestor.create({
      data: { ...contactFields, startupId: startup.id },
    });
    contactsById.set(seed.id, contact);

    if (!pipelineSeed) continue;

    const entry = await prisma.pipeline.create({
      data: {
        id: pipelineSeed.id,
        startupId: startup.id,
        roundId: round.id,
        startupInvestorId: contact.id,
        stage: pipelineSeed.stage,
        expectedAmount: pipelineSeed.expectedAmount ?? null,
        probabilityPercentage: pipelineSeed.probabilityPercentage ?? null,
        priority: pipelineSeed.priority ?? null,
        investorFitScore: pipelineSeed.investorFitScore ?? null,
        ownerId: pipelineSeed.ownedByFounder ? founderMember.id : null,
      },
    });
    pipelinesById.set(seed.id, entry);

    if (followupInDays === undefined) continue;

    // Only future follow-ups surface on the Investors screen, so keep these
    // relative to now — a fixed date would silently go stale.
    await prisma.interactionLog.create({
      data: {
        id: followupLogId(seed.id),
        startupInvestorId: contact.id,
        pipelineId: entry.id,
        createdBy: founder.id,
        type: "call",
        subject: `Follow-up with ${contact.fullName}`,
        description: "Scheduled the next touchpoint.",
        interactionDate: days(-2),
        nextFollowupDate: days(followupInDays),
      },
    });
  }

  // Anchor records for commitments, audit logs and notifications.
  const startupInvestor = contactsById.get("00000000-0000-0000-0000-000000000020")!;
  const pipeline = pipelinesById.get("00000000-0000-0000-0000-000000000020")!;

  // 8. Tasks — one overdue (Focus tab and notifications should pick this up),
  // one due today, and one already completed, so every state renders.
  const sarahPipeline = pipelinesById.get("00000000-0000-0000-0000-000000000020")!;
  const marcusPipeline = pipelinesById.get("00000000-0000-0000-0000-000000000021")!;
  const priyaPipeline = pipelinesById.get("00000000-0000-0000-0000-000000000022")!;

  await prisma.task.create({
    data: {
      startupId: startup.id,
      pipelineId: sarahPipeline.id,
      title: "Send data room access",
      description: "Share the data room link once legal finishes the redlines.",
      priority: "high",
      dueDate: days(-2),
      assigneeId: founderMember.id,
      createdBy: founder.id,
    },
  });

  await prisma.task.create({
    data: {
      startupId: startup.id,
      pipelineId: marcusPipeline.id,
      title: "Schedule founding team intro call",
      priority: "medium",
      dueDate: new Date(),
      assigneeId: founderMember.id,
      createdBy: founder.id,
    },
  });

  await prisma.task.create({
    data: {
      startupId: startup.id,
      pipelineId: priyaPipeline.id,
      title: "Send SAFE for signature",
      priority: "medium",
      status: "completed",
      completedAt: days(-1),
      assigneeId: founderMember.id,
      createdBy: founder.id,
    },
  });

  // 9. Commitment linking the investor to the round
  await prisma.commitment.create({
    data: {
      id: "00000000-0000-0000-0000-000000000032",
      startupId: startup.id,
      startupInvestorId: startupInvestor.id,
      pipelineId: pipeline.id,
      roundId: round.id,
      amount: 50000,
      status: "negotiating",
    },
  });

  // 11. Interaction log — first touchpoint with the investor
  await prisma.interactionLog.create({
    data: {
      id: "00000000-0000-0000-0000-000000000033",
      startupInvestorId: startupInvestor.id,
      pipelineId: pipeline.id,
      createdBy: founder.id,
      type: "email",
      subject: "Introduction — Acme Corp",
      description: "Sent intro email with deck link. Investor confirmed receipt and expressed interest.",
      interactionDate: new Date(),
    },
  });

  // 12. Audit logs
  await prisma.auditLog.create({
    data: {
      id: "00000000-0000-0000-0000-000000000040",
      startupId: startup.id,
      userId: founder.id,
      action: "create",
      entityType: "startup",
      entityId: startup.id,
      changes: { name: startup.name, fundingStage: startup.fundingStage },
      ipAddress: "127.0.0.1",
    },
  });

  await prisma.auditLog.create({
    data: {
      id: "00000000-0000-0000-0000-000000000041",
      startupId: startup.id,
      userId: founder.id,
      action: "create",
      entityType: "investor",
      entityId: startupInvestor.id,
      changes: { fullName: startupInvestor.fullName, ventureFirm: startupInvestor.ventureFirm, source: "event" },
      ipAddress: "127.0.0.1",
    },
  });

  await prisma.auditLog.create({
    data: {
      id: "00000000-0000-0000-0000-000000000042",
      startupId: startup.id,
      userId: founder.id,
      action: "update",
      entityType: "pipeline",
      entityId: pipeline.id,
      changes: { stage: { from: "sourced", to: "meeting_scheduled" } },
      ipAddress: "127.0.0.1",
    },
  });

  // 13. Notifications
  await prisma.notification.create({
    data: {
      id: "00000000-0000-0000-0000-000000000050",
      startupId: startup.id,
      userId: founder.id,
      type: "investor_added",
      title: "New investor added",
      body: `${startupInvestor.fullName} from ${startupInvestor.ventureFirm} has been added to your pipeline.`,
      entityType: "investor",
      entityId: startupInvestor.id,
    },
  });

  await prisma.notification.create({
    data: {
      id: "00000000-0000-0000-0000-000000000051",
      startupId: startup.id,
      userId: founder.id,
      type: "pipeline_stage_changed",
      title: "Meeting scheduled with investor",
      body: `${startupInvestor.fullName} has been moved to Meeting Scheduled stage.`,
      entityType: "pipeline",
      entityId: pipeline.id,
    },
  });

  console.info("─── Seed complete ───────────────────────────────────────");
  console.info("  Founder:      founder@example.com");
  console.info(`  Startup:      ${startup.name}`);
  console.info(`  Roles:        owner · collaborator · viewer`);
  console.info(`  Permissions:  ${PERMISSIONS.length} entries`);
  console.info(`  Contacts:     ${CONTACTS.length} (${pipelinesById.size} in pipeline)`);
  console.info(`  Follow-ups:   ${CONTACTS.filter((c) => c.followupInDays !== undefined).length} upcoming`);
  console.info(`  Round:        Pre-Seed — $500,000 target`);
  console.info(`  Commitment:   $50,000 negotiating`);
  console.info(`  Tasks:        3 (1 overdue, 1 due today, 1 completed)`);
  console.info(`  Audit logs:   3 entries`);
  console.info(`  Notifications: 2 entries`);
  console.info("─────────────────────────────────────────────────────────");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
