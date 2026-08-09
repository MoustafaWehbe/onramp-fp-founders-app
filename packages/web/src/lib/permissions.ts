
export type Resource = "startup" | "team" | "pipeline" | "documents" | "financial" | "ai_reports";
export type Action = "read" | "create" | "update" | "delete" | "share";

const ALL_PERMISSIONS = [
  "startup:read",
  "startup:update",
  "startup:delete",
  "team:read",
  "team:create",
  "team:update",
  "team:delete",
  "pipeline:read",
  "pipeline:create",
  "pipeline:update",
  "pipeline:delete",
  "documents:read",
  "documents:create",
  "documents:update",
  "documents:delete",
  "documents:share",
  "financial:read",
  "financial:create",
  "financial:update",
  "financial:delete",
  "ai_reports:read",
  "ai_reports:create",
] as const;

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: ALL_PERMISSIONS,
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

export function roleCan(role: string | null, resource: Resource, action: Action): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(`${resource}:${action}`) ?? false;
}
