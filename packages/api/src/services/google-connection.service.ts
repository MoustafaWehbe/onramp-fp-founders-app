import crypto from "crypto";
import { prisma } from "../db/prisma";
import { getRedis } from "../db/redis";
import { createError } from "../utils/errors";
import { encryptSecret, decryptSecret } from "../utils/crypto";
import { createGoogleOAuthClient, GOOGLE_OAUTH_SCOPES } from "../config/google";
import { isGoogleIntegrationEnabled } from "../config/env";

const STATE_TTL_SECONDS = 10 * 60;
const STATE_KEY = (state: string) => `google-oauth:state:${state}`;
const ACCESS_TOKEN_KEY = (userId: string) => `google-oauth:access-token:${userId}`;

// Refresh a little before Google's own expiry so a token never goes stale
// mid-request, and never trust a cached value for longer than this even if
// Google reports a long-lived one.
const ACCESS_TOKEN_MIN_TTL_SECONDS = 60;
const ACCESS_TOKEN_SAFETY_BUFFER_SECONDS = 60;

function requireConfigured(): void {
  if (!isGoogleIntegrationEnabled()) {
    throw createError(
      "Google integration is not configured on this deployment",
      503,
      "GOOGLE_INTEGRATION_DISABLED",
    );
  }
}

export interface GoogleConnectionStatus {
  connected: boolean;
  googleEmail?: string;
  scopes?: string[];
  status?: string;
  calendarSyncEnabled?: boolean;
  lastSyncedAt?: Date | null;
  lastError?: string | null;
}

export class GoogleConnectionService {
  /**
   * Starts the consent flow: binds a one-time state token to this user in
   * Redis (never trust a state value that isn't ours) and returns the URL to
   * redirect the browser to.
   */
  async buildAuthUrl(userId: string): Promise<string> {
    requireConfigured();

    const state = crypto.randomBytes(24).toString("hex");
    await getRedis().set(STATE_KEY(state), userId, "EX", STATE_TTL_SECONDS);

    const client = createGoogleOAuthClient();
    return client.generateAuthUrl({
      access_type: "offline",
      // Forces Google to return a refresh token even on a reconnect where the
      // user already granted consent once before — without this, a second
      // consent silently omits it.
      prompt: "consent",
      scope: [...GOOGLE_OAUTH_SCOPES],
      state,
    });
  }

  /**
   * Completes the consent flow. Resolves the user from the state token rather
   * than the session cookie — Google's redirect is a plain browser navigation
   * that may arrive after the access-token cookie has expired, and the state
   * token is what actually proves this callback belongs to the request that
   * started it.
   */
  async handleCallback(code: string, state: string): Promise<{ userId: string }> {
    requireConfigured();

    const redis = getRedis();
    const userId = await redis.get(STATE_KEY(state));
    if (!userId) {
      throw createError(
        "This connection request expired or was already used. Please try again.",
        400,
        "INVALID_OAUTH_STATE",
      );
    }
    // One-time use, whether or not the exchange below succeeds.
    await redis.del(STATE_KEY(state));

    const client = createGoogleOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      throw createError(
        "Google did not return offline access. Please try connecting again.",
        400,
        "NO_REFRESH_TOKEN",
      );
    }
    if (!tokens.id_token) {
      throw createError("Google did not confirm an account identity", 400, "NO_ID_TOKEN");
    }

    client.setCredentials(tokens);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const email = ticket.getPayload()?.email;
    if (!email) {
      throw createError("Google did not return an account email", 400, "NO_GOOGLE_EMAIL");
    }

    await prisma.googleConnection.upsert({
      where: { userId },
      create: {
        userId,
        googleEmail: email,
        scopes: tokens.scope ?? GOOGLE_OAUTH_SCOPES.join(" "),
        refreshTokenCipher: encryptSecret(tokens.refresh_token),
        status: "active",
      },
      update: {
        googleEmail: email,
        scopes: tokens.scope ?? GOOGLE_OAUTH_SCOPES.join(" "),
        refreshTokenCipher: encryptSecret(tokens.refresh_token),
        status: "active",
        lastError: null,
        // A fresh connect deliberately does not reset calendarSyncToken —
        // reconnecting after a lapsed grant should resume where sync left off
        // rather than replaying history the founder already saw.
      },
    });

    await redis.del(ACCESS_TOKEN_KEY(userId));

    return { userId };
  }

  async getStatus(userId: string): Promise<GoogleConnectionStatus> {
    const connection = await prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) return { connected: false };

    return {
      connected: connection.status === "active",
      googleEmail: connection.googleEmail,
      scopes: connection.scopes.split(" ").filter(Boolean),
      status: connection.status,
      calendarSyncEnabled: connection.calendarSyncEnabled,
      lastSyncedAt: connection.lastSyncedAt,
      lastError: connection.lastError,
    };
  }

  async setCalendarSyncEnabled(userId: string, enabled: boolean): Promise<void> {
    const connection = await prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) {
      throw createError("Google account is not connected", 409, "GOOGLE_NOT_CONNECTED");
    }
    await prisma.googleConnection.update({ where: { userId }, data: { calendarSyncEnabled: enabled } });
  }

  /**
   * Returns a live access token for this user's connection, refreshing and
   * caching it as needed. Any caller doing Calendar or Gmail work on the
   * user's behalf goes through this rather than touching the refresh token
   * directly.
   */
  async getValidAccessToken(userId: string): Promise<string> {
    requireConfigured();

    const redis = getRedis();
    const cached = await redis.get(ACCESS_TOKEN_KEY(userId));
    if (cached) return cached;

    const connection = await prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) {
      throw createError("Google account is not connected", 409, "GOOGLE_NOT_CONNECTED");
    }
    if (connection.status !== "active") {
      throw createError(
        "Google connection needs to be reconnected",
        409,
        "GOOGLE_NEEDS_REAUTH",
      );
    }

    const client = createGoogleOAuthClient();
    client.setCredentials({ refresh_token: decryptSecret(connection.refreshTokenCipher) });

    let accessToken: string;
    let expiryMs: number | null | undefined;
    try {
      const result = await client.getAccessToken();
      if (!result.token) throw new Error("Google returned no access token");
      accessToken = result.token;
      expiryMs = client.credentials.expiry_date;
    } catch (err) {
      if (isInvalidGrant(err)) {
        await prisma.googleConnection.update({
          where: { userId },
          data: { status: "needs_reauth", lastError: "invalid_grant" },
        });
        throw createError(
          "Google connection needs to be reconnected",
          409,
          "GOOGLE_NEEDS_REAUTH",
        );
      }
      throw err;
    }

    const ttlSeconds = expiryMs
      ? Math.max(
          ACCESS_TOKEN_MIN_TTL_SECONDS,
          Math.floor((expiryMs - Date.now()) / 1_000) - ACCESS_TOKEN_SAFETY_BUFFER_SECONDS,
        )
      : ACCESS_TOKEN_MIN_TTL_SECONDS;
    await redis.set(ACCESS_TOKEN_KEY(userId), accessToken, "EX", ttlSeconds);

    return accessToken;
  }

  /**
   * Revokes the grant at Google first — deleting only our row would leave the
   * founder believing they disconnected while our refresh token (if it leaked)
   * remained usable at Google.
   */
  async disconnect(userId: string): Promise<void> {
    const connection = await prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) return;

    const client = createGoogleOAuthClient();
    try {
      await client.revokeToken(decryptSecret(connection.refreshTokenCipher));
    } catch (err) {
      // Already revoked at Google (e.g. the user disconnected from their
      // Google Account settings first) is the common case here, not an error
      // worth failing the request over — we still clear our own side below.
      console.error("[google-connection] revoke failed, clearing local record anyway:", err);
    }

    await prisma.googleConnection.delete({ where: { userId } });
    await getRedis().del(ACCESS_TOKEN_KEY(userId));
  }
}

function isInvalidGrant(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("invalid_grant");
}

export const googleConnectionService = new GoogleConnectionService();
