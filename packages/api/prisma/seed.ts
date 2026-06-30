import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/auth";

const prisma = new PrismaClient();

// ─── Permission matrix ────────────────────────────────────────────────────────

const PERMISSIONS = [
  // Startup management
  { resource: "startup", action: "read", description: "View startup profile" },
  { resource: "startup", action: "update", description: "Edit startup profile" },
  { resource: "startup", action: "delete", description: "Delete startup" },

  // Team management
  { resource: "team", action: "read", description: "View team members" },
  { resource: "team", action: "create", description: "Invite team members" },
  { resource: "team", action: "update", description: "Change member roles" },
  { resource: "team", action: "delete", description: "Remove team members" },

  // CRM / Pipeline
  { resource: "pipeline", action: "read", description: "View investors and pipeline" },
  { resource: "pipeline", action: "create", description: "Add investors and pipeline entries" },
  { resource: "pipeline", action: "update", description: "Move pipeline stages, edit investors" },
  { resource: "pipeline", action: "delete", description: "Remove investors and pipeline entries" },

  // Documents
  { resource: "documents", action: "read", description: "View documents" },
  { resource: "documents", action: "create", description: "Upload documents" },
  { resource: "documents", action: "update", description: "Upload new versions" },
  { resource: "documents", action: "delete", description: "Remove documents" },
  { resource: "documents", action: "share", description: "Share documents with reviewers" },

  // Financial
  { resource: "financial", action: "read", description: "View rounds and commitments" },
  { resource: "financial", action: "create", description: "Create rounds and commitments" },
  { resource: "financial", action: "update", description: "Edit rounds and commitments" },
  { resource: "financial", action: "delete", description: "Remove rounds and commitments" },

  // AI
  { resource: "ai_reports", action: "read", description: "View AI analyses and chat" },
  { resource: "ai_reports", action: "create", description: "Trigger AI analysis and start chats" },
];

const ROLE_TEMPLATES = {
  owner: PERMISSIONS.map((p) => `${p.resource}:${p.action}`),
  collaborator: [
    "startup:read",
    "team:read",
    "pipeline:read",
    "pipeline:create",
    "pipeline:update",
    "documents:read",
    "documents:create",
    "documents:update",
    "financial:read",
    "ai_reports:read",
    "ai_reports:create",
  ],
  viewer: [
    "startup:read",
    "team:read",
    "pipeline:read",
    "documents:read",
    "financial:read",
    "ai_reports:read",
  ],
};

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
  console.info(`  Permissions:  ${PERMISSIONS.length} entries`);
  console.info(`  Investor:     ${investor.fullName} — ${investor.ventureFirm}`);
  console.info("─────────────────────────────────────────────────────────");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
