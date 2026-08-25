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
  { resource: "chat", action: "manage", description: "Archive and restore team channels" },
] as const;

export type PermissionKey = `${(typeof PERMISSIONS)[number]["resource"]}:${string}`;

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => `${p.resource}:${p.action}`);

/**
 * Human-facing metadata for each resource, in one place so the role editor,
 * the "no access" screens, and the copilot's refusals all name a permission
 * the same way the Team & Roles page labels it. `topics` is what the copilot
 * says it cannot reach — phrased as subject matter a founder would recognize,
 * not as a database table.
 */
export const RESOURCE_META = {
  startup: {
    label: "Startup profile",
    topics: "the startup profile and company details",
  },
  team: {
    label: "Team",
    topics: "team members, roles, and invitations",
  },
  pipeline: {
    label: "Investors & pipeline",
    topics: "investors, deals, pipeline stages, tasks, and interaction history",
  },
  documents: {
    label: "Documents",
    topics: "documents, the data room, and reviewer engagement",
  },
  financial: {
    label: "Rounds & commitments",
    topics: "fundraising rounds, commitments, amounts raised, and round forecasts",
  },
  ai_reports: {
    label: "AI analysis",
    topics: "AI analyses and copilot chat",
  },
  chat: {
    label: "Team chat",
    topics: "team conversations and messages",
  },
} as const satisfies Record<(typeof PERMISSIONS)[number]["resource"], { label: string; topics: string }>;

export type ResourceName = keyof typeof RESOURCE_META;

/**
 * Grants that are meaningless — and actively break screens — without another
 * grant alongside them. Editing a deal you cannot list, or archiving a channel
 * you cannot open, is not a narrower role: it is a role whose page renders
 * empty while the API returns 403 on the reads behind it.
 *
 * These are closed over on every role write (see `expandPermissionKeys`), so a
 * role can never be persisted in that broken shape regardless of which client
 * sent it. The role editor mirrors the same map to keep the checkbox state
 * honest before the request is even made.
 */
export const PERMISSION_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  "startup:update": ["startup:read"],
  "startup:delete": ["startup:read"],

  "team:create": ["team:read"],
  "team:update": ["team:read"],
  "team:delete": ["team:read"],
  "team:manage": ["team:read"],

  "pipeline:create": ["pipeline:read"],
  "pipeline:update": ["pipeline:read"],
  "pipeline:delete": ["pipeline:read"],

  "documents:create": ["documents:read"],
  "documents:update": ["documents:read"],
  "documents:delete": ["documents:read"],
  "documents:share": ["documents:read"],

  // Every write path here reads the round it is writing to, and the Rounds
  // screen is a read screen with buttons on it.
  "financial:create": ["financial:read"],
  "financial:update": ["financial:read"],
  "financial:delete": ["financial:read"],

  "ai_reports:create": ["ai_reports:read"],

  "chat:create": ["chat:read"],
  "chat:manage": ["chat:read"],
};

/**
 * The transitive closure of `PERMISSION_DEPENDENCIES` over the given keys,
 * de-duplicated and returned in catalog order so audit-log diffs of a role's
 * grants stay stable rather than reflecting whatever order a client sent.
 * Unknown keys pass through untouched — validating them is
 * `resolvePermissionIds`'s job, and swallowing them here would turn a typo
 * into a silently narrower role.
 */
export function expandPermissionKeys(keys: Iterable<string>): string[] {
  const resolved = new Set<string>();
  const queue = [...keys];

  while (queue.length > 0) {
    const key = queue.pop()!;
    if (resolved.has(key)) continue;
    resolved.add(key);
    for (const dependency of PERMISSION_DEPENDENCIES[key] ?? []) {
      if (!resolved.has(dependency)) queue.push(dependency);
    }
  }

  const ordered = PERMISSION_KEYS.filter((key) => resolved.has(key));
  const unknown = [...resolved].filter((key) => !PERMISSION_KEYS.includes(key)).sort();
  return [...ordered, ...unknown];
}

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
