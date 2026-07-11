import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/auth";
import { PERMISSIONS, ROLE_TEMPLATES } from "../src/config/permissions";

const prisma = new PrismaClient();

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

  // 7. Sample investor
  const investor = await prisma.investor.upsert({
    where: { email: "investor@vc.example.com" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000020",
      fullName: "John Smith",
      email: "investor@vc.example.com",
      ventureFirm: "Accel Partners",
      sectorFocus: "SaaS",
      investmentStagePreference: "pre_seed",
      linkedinUrl: "https://linkedin.com/in/johnsmith",
    },
  });

  // 8. Link investor to startup
  const startupInvestor = await prisma.startupInvestor.upsert({
    where: { startupId_investorId: { startupId: startup.id, investorId: investor.id } },
    update: {},
    create: {
      startupId: startup.id,
      investorId: investor.id,
      notes: "Met at TechCrunch Disrupt. Very interested in our GTM strategy.",
      source: "event",
    },
  });

  // 9. Pipeline entry for the investor
  const pipeline = await prisma.pipeline.upsert({
    where: {
      startupId_startupInvestorId: {
        startupId: startup.id,
        startupInvestorId: startupInvestor.id,
      },
    },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000030",
      startupId: startup.id,
      startupInvestorId: startupInvestor.id,
      stage: "meeting_scheduled",
      expectedAmount: 250000,
      probabilityPercentage: 40,
    },
  });

  // 10. Fundraising round
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

  // 11. Commitment linking the investor to the round
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

  // 12. Interaction log — first touchpoint with the investor
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

  // 13. Audit logs
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
      entityId: investor.id,
      changes: { fullName: investor.fullName, ventureFirm: investor.ventureFirm, source: "event" },
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
      changes: { stage: { from: "prospect", to: "meeting_scheduled" } },
      ipAddress: "127.0.0.1",
    },
  });

  // 14. Notifications
  await prisma.notification.upsert({
    where: { id: "00000000-0000-0000-0000-000000000050" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000050",
      startupId: startup.id,
      userId: founder.id,
      type: "investor_added",
      title: "New investor added",
      body: `${investor.fullName} from ${investor.ventureFirm} has been added to your pipeline.`,
      entityType: "investor",
      entityId: investor.id,
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
      body: `${investor.fullName} has been moved to Meeting Scheduled stage.`,
      entityType: "pipeline",
      entityId: pipeline.id,
    },
  });

  console.info("─── Seed complete ───────────────────────────────────────");
  console.info("  Founder:      founder@example.com");
  console.info(`  Startup:      ${startup.name}`);
  console.info(`  Roles:        owner · collaborator · viewer`);
  console.info(`  Permissions:  ${PERMISSIONS.length} entries`);
  console.info(`  Investor:     ${investor.fullName} — ${investor.ventureFirm}`);
  console.info(`  Round:        Pre-Seed — $500,000 target`);
  console.info(`  Commitment:   $50,000 negotiating`);
  console.info(`  Audit logs:   3 entries`);
  console.info(`  Notifications: 2 entries`);
  console.info("─────────────────────────────────────────────────────────");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
