import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/auth";
import { PERMISSIONS, ROLE_TEMPLATES } from "../src/config/permissions";
import type { InvestorType, PipelineStage } from "../src/config/crm";

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
  };
  /** Days from now for the next follow-up; omit for contacts with none due. */
  followupInDays?: number;
}

/** Derives a stable interaction-log id from a contact id, so re-seeding is idempotent. */
const followupLogId = (contactId: string): string => `0000ff00${contactId.slice(8)}`;

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Founder user
  const passwordHash = await hashPassword("Founder1234!");

  const founder = await prisma.user.upsert({
    where: { email: "founder@example.com" },
    update: {
      firstName: "Jane",
      lastName: "Doe",
      passwordHash,
      authProvider: "local",
      emailVerifiedAt: new Date(),
    },
    create: {
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
  const startup = await prisma.startup.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
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
  await prisma.permission.createMany({ data: PERMISSIONS, skipDuplicates: true });

  const allPermissions = await prisma.permission.findMany();

  // 4. System roles
  const ownerRole = await prisma.role.upsert({
    where: { startupId_name: { startupId: startup.id, name: "owner" } },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000010",
      startupId: startup.id,
      name: "owner",
      description: "Full access to all resources",
      isSystemRole: true,
    },
  });

  const collaboratorRole = await prisma.role.upsert({
    where: { startupId_name: { startupId: startup.id, name: "collaborator" } },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000011",
      startupId: startup.id,
      name: "collaborator",
      description: "Can edit pipeline and documents, no billing access",
      isSystemRole: true,
    },
  });

  const viewerRole = await prisma.role.upsert({
    where: { startupId_name: { startupId: startup.id, name: "viewer" } },
    update: {},
    create: {
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
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // 6. Founder as owner member
  await prisma.startupMember.upsert({
    where: { startupId_userId: { startupId: startup.id, userId: founder.id } },
    update: {},
    create: {
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
  ];

  const contactsById = new Map<string, { id: string; fullName: string; ventureFirm: string | null }>();
  const pipelinesById = new Map<string, { id: string }>();

  for (const seed of CONTACTS) {
    const { pipeline: pipelineSeed, followupInDays, ...contactFields } = seed;

    // Upsert by id (not email) so re-seeding refreshes an existing row in place
    // rather than leaving a stale duplicate behind when a field changes.
    const contact = await prisma.startupInvestor.upsert({
      where: { id: seed.id },
      update: { ...contactFields, startupId: startup.id },
      create: { ...contactFields, startupId: startup.id },
    });
    contactsById.set(seed.id, contact);

    if (!pipelineSeed) continue;

    // Keyed on the fixed id rather than [startupId, startupInvestorId] so a
    // re-seed repoints an existing entry instead of colliding on the id.
    const entry = await prisma.pipeline.upsert({
      where: { id: pipelineSeed.id },
      update: {
        startupInvestorId: contact.id,
        stage: pipelineSeed.stage,
        expectedAmount: pipelineSeed.expectedAmount ?? null,
        probabilityPercentage: pipelineSeed.probabilityPercentage ?? null,
      },
      create: {
        id: pipelineSeed.id,
        startupId: startup.id,
        startupInvestorId: contact.id,
        stage: pipelineSeed.stage,
        expectedAmount: pipelineSeed.expectedAmount ?? null,
        probabilityPercentage: pipelineSeed.probabilityPercentage ?? null,
      },
    });
    pipelinesById.set(seed.id, entry);

    if (followupInDays === undefined) continue;

    // Only future follow-ups surface on the Investors screen, so keep these
    // relative to now — a fixed date would silently go stale.
    await prisma.interactionLog.upsert({
      where: { id: followupLogId(seed.id) },
      update: { nextFollowupDate: days(followupInDays) },
      create: {
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

  // Anchor records the fundraising round, audit logs and notifications hang off.
  const startupInvestor = contactsById.get("00000000-0000-0000-0000-000000000020")!;
  const pipeline = pipelinesById.get("00000000-0000-0000-0000-000000000020")!;

  // 9. Fundraising round
  const round = await prisma.fundraisingRound.upsert({
    where: { startupId_id: { startupId: startup.id, id: "00000000-0000-0000-0000-000000000031" } },
    update: {},
    create: {
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

  // 10. Commitment linking the investor to the round
  await prisma.commitment.upsert({
    where: { id: "00000000-0000-0000-0000-000000000032" },
    update: {},
    create: {
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
  await prisma.interactionLog.upsert({
    where: { id: "00000000-0000-0000-0000-000000000033" },
    update: {},
    create: {
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
  await prisma.auditLog.upsert({
    where: { id: "00000000-0000-0000-0000-000000000040" },
    update: {},
    create: {
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

  await prisma.auditLog.upsert({
    where: { id: "00000000-0000-0000-0000-000000000041" },
    update: {},
    create: {
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

  await prisma.auditLog.upsert({
    where: { id: "00000000-0000-0000-0000-000000000042" },
    update: {},
    create: {
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
  await prisma.notification.upsert({
    where: { id: "00000000-0000-0000-0000-000000000050" },
    update: {},
    create: {
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

  await prisma.notification.upsert({
    where: { id: "00000000-0000-0000-0000-000000000051" },
    update: {},
    create: {
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
  console.info(`  Audit logs:   3 entries`);
  console.info(`  Notifications: 2 entries`);
  console.info("─────────────────────────────────────────────────────────");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
