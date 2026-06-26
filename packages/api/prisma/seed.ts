import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/auth";

const prisma = new PrismaClient();

// ─── Permission matrix ────────────────────────────────────────────────────────

const RESOURCES = ["pipeline", "documents", "ai_reports", "team", "billing"];
const ACTIONS = ["create", "read", "update", "delete", "share"];

const COLLABORATOR_DENIED = [
  { resource: "billing", action: "create" },
  { resource: "billing", action: "update" },
  { resource: "billing", action: "delete" },
  { resource: "billing", action: "share" },
  { resource: "team", action: "delete" },
];

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

  // 3. Permissions (all resource × action combinations)
  const permissionData = RESOURCES.flatMap((resource) =>
    ACTIONS.map((action) => ({ resource, action, description: `${action} ${resource}` })),
  );

  await prisma.permission.createMany({ data: permissionData, skipDuplicates: true });

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
  // Owner: all permissions
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: ownerRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: ownerRole.id, permissionId: perm.id },
    });
  }

  // Collaborator: everything except billing write and team delete
  const collaboratorPerms = allPermissions.filter(
    (p) => !COLLABORATOR_DENIED.some((d) => d.resource === p.resource && d.action === p.action),
  );
  for (const perm of collaboratorPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: collaboratorRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: collaboratorRole.id, permissionId: perm.id },
    });
  }

  // Viewer: read-only, no billing
  const viewerPerms = allPermissions.filter(
    (p) => p.action === "read" && p.resource !== "billing",
  );
  for (const perm of viewerPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: viewerRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: viewerRole.id, permissionId: perm.id },
    });
  }

  // 6. Founder as owner member
  await prisma.startupMember.upsert({
    where: { startupId_userId: { startupId: startup.id, userId: founder.id } },
    update: {},
    create: {
      startupId: startup.id,
      userId: founder.id,
      roleId: ownerRole.id,
      status: "accepted",
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
  await prisma.pipeline.upsert({
    where: {
      startupId_startupInvestorId: {
        startupId: startup.id,
        startupInvestorId: startupInvestor.id,
      },
    },
    update: {},
    create: {
      startupId: startup.id,
      startupInvestorId: startupInvestor.id,
      stage: "meeting_scheduled",
      expectedAmount: 250000,
      probabilityPercentage: 40,
    },
  });

  console.info("─── Seed complete ───────────────────────────────────────");
  console.info("  Founder:      founder@example.com");
  console.info(`  Startup:      ${startup.name}`);
  console.info(`  Roles:        owner · collaborator · viewer`);
  console.info(`  Permissions:  ${RESOURCES.length * ACTIONS.length} entries (${RESOURCES.join(", ")})`);
  console.info(`  Investor:     ${investor.fullName} — ${investor.ventureFirm}`);
  console.info("─────────────────────────────────────────────────────────");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
