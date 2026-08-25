/**
 * The client's mirror of packages/api/src/config/permissions.ts.
 *
 * It decides what the UI offers, never what the server allows: a wrong check
 * here is a UX bug, a missing check there is a security bug. A vitest suite
 * imports the API's catalog directly and fails the build the moment the two
 * drift, because the failure mode otherwise is silent — buttons that 403, or
 * pages hidden from people who could have used them.
 */

export type Resource =
  | "startup"
  | "team"
  | "pipeline"
  | "documents"
  | "financial"
  | "ai_reports"
  | "chat";
export type Action = "read" | "create" | "update" | "delete" | "share" | "manage";
export type PermissionKey = `${Resource}:${Action}`;

/**
 * Labels and per-action wording for every resource, in catalog order. The role
 * editor renders straight from this, and the "no access" screens and the
 * copilot's refusals reuse the same `label` so a founder reads one name for a
 * permission wherever it comes up.
 */
export const PERMISSION_CATALOG: {
  resource: Resource;
  label: string;
  /** Shown on the empty state when a page is unreachable. */
  blurb: string;
  actions: { action: Action; label: string }[];
}[] = [
  {
    resource: "startup",
    label: "Startup profile",
    blurb: "the startup profile and company details",
    actions: [
      { action: "read", label: "View" },
      { action: "update", label: "Edit" },
      { action: "delete", label: "Delete" },
    ],
  },
  {
    resource: "team",
    label: "Team",
    blurb: "team members, roles, and invitations",
    actions: [
      { action: "read", label: "View members" },
      { action: "create", label: "Invite" },
      { action: "update", label: "Change roles" },
      { action: "delete", label: "Remove members" },
      { action: "manage", label: "Manage roles" },
    ],
  },
  {
    resource: "pipeline",
    label: "Investors & pipeline",
    blurb: "investors, deals, pipeline stages, tasks, and interaction history",
    actions: [
      { action: "read", label: "View" },
      { action: "create", label: "Add" },
      { action: "update", label: "Edit" },
      { action: "delete", label: "Delete" },
    ],
  },
  {
    resource: "documents",
    label: "Documents",
    blurb: "documents, the data room, and reviewer engagement",
    actions: [
      { action: "read", label: "View" },
      { action: "create", label: "Upload" },
      { action: "update", label: "New versions" },
      { action: "delete", label: "Delete" },
      { action: "share", label: "Share with reviewers" },
    ],
  },
  {
    resource: "financial",
    label: "Rounds & commitments",
    blurb: "fundraising rounds, commitments, and amounts raised",
    actions: [
      { action: "read", label: "View" },
      { action: "create", label: "Create" },
      { action: "update", label: "Edit" },
      { action: "delete", label: "Delete" },
    ],
  },
  {
    resource: "ai_reports",
    label: "AI analysis",
    blurb: "AI analyses and the copilot",
    actions: [
      { action: "read", label: "View" },
      { action: "create", label: "Run" },
    ],
  },
  {
    resource: "chat",
    label: "Team chat",
    blurb: "team conversations and messages",
    actions: [
      { action: "read", label: "View" },
      { action: "create", label: "Post" },
      { action: "manage", label: "Archive & moderate" },
    ],
  },
];

export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSION_CATALOG.flatMap((group) =>
  group.actions.map((action) => `${group.resource}:${action.action}` as PermissionKey),
);

const RESOURCE_LABELS = new Map(PERMISSION_CATALOG.map((group) => [group.resource, group.label]));
const ACTION_LABELS = new Map<string, string>(
  PERMISSION_CATALOG.flatMap((group) =>
    group.actions.map((action) => [`${group.resource}:${action.action}`, action.label] as [string, string]),
  ),
);

/** e.g. "Rounds & commitments: View" — how the role editor names that checkbox. */
export function permissionLabel(key: string): string {
  const [resource] = key.split(":");
  const group = RESOURCE_LABELS.get(resource as Resource);
  const action = ACTION_LABELS.get(key);
  return group && action ? `${group}: ${action}` : key;
}

export function resourceLabel(resource: Resource): string {
  return RESOURCE_LABELS.get(resource) ?? resource;
}

export function resourceBlurb(resource: Resource): string {
  return PERMISSION_CATALOG.find((group) => group.resource === resource)?.blurb ?? resource;
}

/**
 * Mirrors PERMISSION_DEPENDENCIES on the server. Kept in sync by the drift
 * test; the server closes over it on every write regardless, so the worst a
 * stale copy here can do is show a checkbox state the save then corrects.
 */
export const PERMISSION_DEPENDENCIES: Readonly<Record<string, readonly PermissionKey[]>> = {
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

  "financial:create": ["financial:read"],
  "financial:update": ["financial:read"],
  "financial:delete": ["financial:read"],

  "ai_reports:create": ["ai_reports:read"],

  "chat:create": ["chat:read"],
  "chat:manage": ["chat:read"],
};

/** Every grant that would break if `key` were revoked — the inverse of the map above. */
export function permissionsRequiring(key: string): PermissionKey[] {
  return Object.entries(PERMISSION_DEPENDENCIES)
    .filter(([, dependencies]) => (dependencies as readonly string[]).includes(key))
    .map(([dependent]) => dependent as PermissionKey);
}

/** The transitive closure of PERMISSION_DEPENDENCIES, in catalog order. Mirrors the server's expandPermissionKeys. */
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

  const ordered: string[] = ALL_PERMISSIONS.filter((key) => resolved.has(key));
  const unknown = [...resolved].filter((key) => !ordered.includes(key)).sort();
  return [...ordered, ...unknown];
}

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: ALL_PERMISSIONS,
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
};

export function roleCan(role: string | null, resource: Resource, action: Action): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(`${resource}:${action}`) ?? false;
}
