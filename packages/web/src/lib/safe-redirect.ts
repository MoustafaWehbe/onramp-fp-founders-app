/**
 * Resolves a `?next=` parameter to somewhere inside this app.
 *
 * Anything that could leave the origin — an absolute URL, a protocol-relative
 * `//host`, a backslash that browsers normalise to a slash — is discarded in
 * favour of the fallback. Without this, a crafted link could bounce a
 * freshly-authenticated user onto an attacker's page.
 */
export function safeRedirect(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback;

  const path = next.trim();
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//") || path.startsWith("/\\")) return fallback;

  return path;
}
