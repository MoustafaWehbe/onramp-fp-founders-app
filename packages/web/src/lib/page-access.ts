import type { Action, Resource } from "./permissions";

/**
 * What each dashboard route needs before it is worth entering.
 *
 * The point of declaring it once, here, is that the sidebar and the router
 * cannot disagree: a nav item that is hidden is a route that is guarded, and
 * a route that is guarded is a nav item that is hidden. The alternative —
 * which this replaces — is a screen that renders its chrome and then fills
 * with 403 toasts, which reads as a broken page rather than as a permission
 * the workspace never granted.
 *
 * A page lists only what it genuinely cannot render without. Anything it
 * merely degrades without (money on the pipeline board, the Add buttons)
 * stays a `can()` check inside the page.
 */
export type PageRequirement = { resource: Resource; action: Action };

export const PAGE_ACCESS: Record<string, PageRequirement> = {
  "/investors": { resource: "pipeline", action: "read" },
  "/pipeline": { resource: "pipeline", action: "read" },
  "/fundraising": { resource: "financial", action: "read" },
  "/chat": { resource: "chat", action: "read" },
  "/documents": { resource: "documents", action: "read" },
  "/reviewers": { resource: "documents", action: "read" },
  "/ai": { resource: "ai_reports", action: "read" },
  "/team": { resource: "team", action: "read" },
  "/audit": { resource: "startup", action: "read" },
};
