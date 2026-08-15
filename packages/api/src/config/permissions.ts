export const PERMISSIONS = [
  // Startup management
  { resource: "startup", action: "read", description: "View startup profile" },
  { resource: "startup", action: "update", description: "Edit startup profile" },
  { resource: "startup", action: "delete", description: "Delete startup" },

  // Team management
  { resource: "team", action: "read", description: "View team members" },
  { resource: "team", action: "create", description: "Invite team members" },
  { resource: "team", action: "update", description: "Change member roles" },
  { resource: "team", action: "delete", description: "Remove team members" },
  { resource: "team", action: "manage", description: "Create and edit roles and permission grants" },

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

  // Team chat
  { resource: "chat", action: "read", description: "View conversations" },
  { resource: "chat", action: "create", description: "Post messages and create channels" },
  { resource: "chat", action: "manage", description: "Archive channels, remove any message" },
] as const;

export const ROLE_TEMPLATES = {
  owner: PERMISSIONS.map((p) => `${p.resource}:${p.action}`),
  collaborator: [
    "startup:read",
    "team:read",
    "team:create",
    "pipeline:read",
    "pipeline:create",
    "pipeline:update",
    "documents:read",
    "documents:create",
    "documents:update",
    "financial:read",
    "ai_reports:read",
    "ai_reports:create",
    "chat:read",
    "chat:create",
  ],
  viewer: [
    "startup:read",
    "team:read",
    "pipeline:read",
    "documents:read",
    "ai_reports:read",
    "chat:read",
    "chat:create",
  ],
} as const;

export const ROLE_DEFINITIONS = [
  { name: "owner",        description: "Full access to all resources" },
  { name: "collaborator", description: "Can edit pipeline and documents, no billing access" },
  { name: "viewer",       description: "Read-only access" },
] as const;

export type RoleName = keyof typeof ROLE_TEMPLATES;
