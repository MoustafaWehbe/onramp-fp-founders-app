import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const permissions = [
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

// Role templates — for documentation, used when a startup is created
export const roleTemplates = {
  owner: permissions.map((p) => `${p.resource}:${p.action}`),

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

async function main() {
  console.info("Seeding permissions...");

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: perm.resource, action: perm.action } },
      update: { description: perm.description },
      create: perm,
    });
  }

  console.info(`  ✓ ${permissions.length} permissions seeded`);
  console.info("  ─────────────────────────────────────");
  console.info("  Role templates documented for startup creation:");
  console.info(`    owner:         ${roleTemplates.owner.length} permissions`);
  console.info(`    collaborator:  ${roleTemplates.collaborator.length} permissions`);
  console.info(`    viewer:        ${roleTemplates.viewer.length} permissions`);
  console.info("  ─────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("Permission seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());