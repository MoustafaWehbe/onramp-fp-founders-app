import crypto from "crypto";

/**
 * Short-lived token authorizing page-image reads for one reviewer session and
 * one document version.
 *
 * It is a *second* factor, not a replacement for the session cookie: the page
 * route verifies both and checks that the session id inside the token matches
 * the cookie's session. On its own a leaked token proves nothing, and a stolen
 * cookie still cannot enumerate versions without going through the manifest
 * endpoint, which is authorized and logged.
 */

const TOKEN_TTL_SECONDS = 10 * 60;

function secret(): string {
  const value = process.env.PAGE_TOKEN_SECRET ?? process.env.OTP_HMAC_SECRET;
  if (!value) {
    throw new Error("PAGE_TOKEN_SECRET is not set — cannot sign document page tokens");
  }
  return value;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createPageToken(sessionId: string, versionId: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${sessionId}.${versionId}.${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export type PageTokenClaims = { sessionId: string; versionId: string; expiresAt: number };

/** Returns null for anything malformed, mis-signed, or expired — callers should
 * treat every failure identically rather than reporting which check failed. */
export function verifyPageToken(token: string, now = Date.now()): PageTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = sign(payload);
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // length of an attacker-supplied signature is not a secret.
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const fields = payload.split(".");
  if (fields.length !== 3) return null;
  const [sessionId, versionId, expiresRaw] = fields as [string, string, string];

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < now) return null;
  if (!sessionId || !versionId) return null;

  return { sessionId, versionId, expiresAt };
}

export const PAGE_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;
