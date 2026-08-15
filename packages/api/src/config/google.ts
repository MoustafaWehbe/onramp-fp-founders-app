import { OAuth2Client } from "google-auth-library";
import { getGoogleRedirectUri } from "./env";

/**
 * Requested once, at first connect, rather than incrementally per feature —
 * Calendar sync and Gmail send share one connection, and re-prompting for a
 * second scope later would just be a worse version of asking once up front.
 *
 * "openid" + "email" are non-sensitive; the rest are Google "sensitive" scopes
 * (app-verification required, but not the restricted-scope CASA tier). See
 * plan.md deliberately staying off restricted scopes is what keeps this
 * integration reachable without an annual third-party security assessment.
 *
 * calendar.events (not .readonly): scheduling writes events, so the grant
 * needs write access too still the same sensitive tier as the read-only
 * scope it replaces. A connection made under the old readonly-only grant
 * will 403 on a write until the founder reconnects through Settings.
 */
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export function createGoogleOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google integration is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)",
    );
  }

  return new OAuth2Client(clientId, clientSecret, getGoogleRedirectUri());
}
