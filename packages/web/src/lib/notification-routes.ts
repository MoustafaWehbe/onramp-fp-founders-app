import type { AppNotification } from "./notification-api";

/**
 * Where clicking a notification row should take you, keyed off the generic
 * `entityType` the API stores. `null` means there's nowhere sensible to go —
 * the row still marks itself read, it just doesn't navigate.
 */
export function notificationHref(n: AppNotification): string | null {
  if (!n.entityId) return null;

  switch (n.entityType) {
    case "conversation":
      return `/chat?c=${n.entityId}`;
    case "pipeline":
      return `/pipeline?deal=${n.entityId}`;
    case "task":
      // Task notifications don't carry the parent deal id — the Tasks view is the honest destination.
      return "/pipeline?view=tasks";
    case "interaction_log":
      return "/pipeline";
    case "startup_member":
      return "/dashboard";
    default:
      return null;
  }
}
