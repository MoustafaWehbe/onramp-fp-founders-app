/**
 * Display metadata only — labels for the permission matrix editor. Mirrors
 * packages/api/src/config/permissions.ts's PERMISSIONS array, but purely for
 * rendering; it never decides what a role may actually be granted. The server
 * validates every "resource:action" key against its own catalog.
 */
export const PERMISSION_CATALOG: {
  resource: string;
  label: string;
  actions: { action: string; label: string }[];
}[] = [
  {
    resource: "startup",
    label: "Startup profile",
    actions: [
      { action: "read", label: "View" },
      { action: "update", label: "Edit" },
      { action: "delete", label: "Delete" },
    ],
  },
  {
    resource: "team",
    label: "Team",
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
    actions: [
      { action: "read", label: "View" },
      { action: "create", label: "Run" },
    ],
  },
  {
    resource: "chat",
    label: "Team chat",
    actions: [
      { action: "read", label: "View" },
      { action: "create", label: "Post" },
      { action: "manage", label: "Archive & moderate" },
    ],
  },
];
