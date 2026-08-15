import { GoogleConnectionService } from "../../src/services/google-connection.service";
import { encryptSecret, decryptSecret } from "../../src/utils/crypto";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    googleConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

const redisStore = new Map<string, string>();
const mockRedis = {
  get: jest.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null)),
  set: jest.fn((key: string, value: string) => {
    redisStore.set(key, value);
    return Promise.resolve("OK");
  }),
  del: jest.fn((key: string) => {
    redisStore.delete(key);
    return Promise.resolve(1);
  }),
};

jest.mock("../../src/db/redis", () => ({
  getRedis: () => mockRedis,
}));

jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn(),
}));

import { prisma } from "../../src/db/prisma";
import { OAuth2Client } from "google-auth-library";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new GoogleConnectionService();

const USER_ID = "user-1";
const ENCRYPTION_KEY = "ab12cd34ef56ab78cd90ef12ab34cd56ef78ab90cd12ef34ab56cd78ef90ab12";

/** Configures the fake client this call to `new OAuth2Client()` returns. */
function mockOAuth2Client(overrides: Record<string, jest.Mock> = {}) {
  const client = {
    generateAuthUrl: jest.fn(() => "https://accounts.google.com/o/oauth2/auth?mock=1"),
    getToken: jest.fn(),
    setCredentials: jest.fn(),
    verifyIdToken: jest.fn(),
    getAccessToken: jest.fn(),
    revokeToken: jest.fn(),
    credentials: {} as Record<string, unknown>,
    ...overrides,
  };
  (OAuth2Client as jest.Mock).mockImplementation(() => client);
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  redisStore.clear();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/v1/integrations/google/callback";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
});

describe("buildAuthUrl", () => {
  it("refuses to start when the integration is not configured", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    await expect(service.buildAuthUrl(USER_ID)).rejects.toMatchObject({
      code: "GOOGLE_INTEGRATION_DISABLED",
    });
  });

  it("binds a one-time state to the requesting user and requests offline consent", async () => {
    const client = mockOAuth2Client();

    const url = await service.buildAuthUrl(USER_ID);

    expect(url).toBe("https://accounts.google.com/o/oauth2/auth?mock=1");
    expect(client.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: "offline",
        prompt: "consent",
        state: expect.any(String),
      }),
    );

    const state = client.generateAuthUrl.mock.calls[0][0].state as string;
    expect(await mockRedis.get(`google-oauth:state:${state}`)).toBe(USER_ID);
  });
});

describe("handleCallback", () => {
  it("rejects a state it never issued", async () => {
    await expect(service.handleCallback("some-code", "unknown-state")).rejects.toMatchObject({
      code: "INVALID_OAUTH_STATE",
    });
  });

  it("consumes the state token so it cannot be replayed", async () => {
    await redisStore.set(`google-oauth:state:s1`, USER_ID);
    mockOAuth2Client({
      getToken: jest.fn().mockResolvedValue({ tokens: {} }), // no refresh_token -> throws below
    });

    await expect(service.handleCallback("code", "s1")).rejects.toMatchObject({
      code: "NO_REFRESH_TOKEN",
    });
    expect(redisStore.has("google-oauth:state:s1")).toBe(false);
  });

  it("requires a refresh token", async () => {
    redisStore.set(`google-oauth:state:s2`, USER_ID);
    mockOAuth2Client({ getToken: jest.fn().mockResolvedValue({ tokens: { id_token: "id" } }) });

    await expect(service.handleCallback("code", "s2")).rejects.toMatchObject({
      code: "NO_REFRESH_TOKEN",
    });
  });

  it("requires an id token", async () => {
    redisStore.set(`google-oauth:state:s3`, USER_ID);
    mockOAuth2Client({
      getToken: jest.fn().mockResolvedValue({ tokens: { refresh_token: "rt" } }),
    });

    await expect(service.handleCallback("code", "s3")).rejects.toMatchObject({
      code: "NO_ID_TOKEN",
    });
  });

  it("requires the id token to carry an email", async () => {
    redisStore.set(`google-oauth:state:s4`, USER_ID);
    mockOAuth2Client({
      getToken: jest
        .fn()
        .mockResolvedValue({ tokens: { refresh_token: "rt", id_token: "idt", scope: "s" } }),
      verifyIdToken: jest.fn().mockResolvedValue({ getPayload: () => ({}) }),
    });

    await expect(service.handleCallback("code", "s4")).rejects.toMatchObject({
      code: "NO_GOOGLE_EMAIL",
    });
  });

  it("stores the refresh token encrypted and invalidates any cached access token", async () => {
    redisStore.set(`google-oauth:state:s5`, USER_ID);
    redisStore.set(`google-oauth:access-token:${USER_ID}`, "stale-token");
    mockOAuth2Client({
      getToken: jest.fn().mockResolvedValue({
        tokens: {
          refresh_token: "the-refresh-token",
          id_token: "idt",
          scope: "openid email calendar gmail.send",
        },
      }),
      verifyIdToken: jest
        .fn()
        .mockResolvedValue({ getPayload: () => ({ email: "founder@example.com" }) }),
    });
    mockPrisma.googleConnection.upsert.mockResolvedValue({} as never);

    const result = await service.handleCallback("code", "s5");

    expect(result).toEqual({ userId: USER_ID });
    const call = mockPrisma.googleConnection.upsert.mock.calls[0][0] as {
      create: { userId: string; googleEmail: string; refreshTokenCipher: string };
    };
    expect(call.create.userId).toBe(USER_ID);
    expect(call.create.googleEmail).toBe("founder@example.com");
    expect(decryptSecret(call.create.refreshTokenCipher)).toBe("the-refresh-token");
    expect(redisStore.has(`google-oauth:access-token:${USER_ID}`)).toBe(false);
  });
});

describe("getValidAccessToken", () => {
  it("returns a cached token without touching Google or the database", async () => {
    redisStore.set(`google-oauth:access-token:${USER_ID}`, "cached-token");

    const token = await service.getValidAccessToken(USER_ID);

    expect(token).toBe("cached-token");
    expect(mockPrisma.googleConnection.findUnique).not.toHaveBeenCalled();
  });

  it("refuses when there is no connection", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(null);

    await expect(service.getValidAccessToken(USER_ID)).rejects.toMatchObject({
      code: "GOOGLE_NOT_CONNECTED",
    });
  });

  it("refuses when the connection needs reauth", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      status: "needs_reauth",
    } as never);

    await expect(service.getValidAccessToken(USER_ID)).rejects.toMatchObject({
      code: "GOOGLE_NEEDS_REAUTH",
    });
  });

  it("refreshes, caches and returns a fresh access token", async () => {
    const cipher = encryptSecret("real-refresh-token");
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      status: "active",
      refreshTokenCipher: cipher,
    } as never);
    const client = mockOAuth2Client({
      getAccessToken: jest.fn().mockResolvedValue({ token: "fresh-access-token" }),
    });
    client.credentials = { expiry_date: Date.now() + 3_600_000 };

    const token = await service.getValidAccessToken(USER_ID);

    expect(token).toBe("fresh-access-token");
    expect(client.setCredentials).toHaveBeenCalledWith({ refresh_token: "real-refresh-token" });
    expect(await mockRedis.get(`google-oauth:access-token:${USER_ID}`)).toBe(
      "fresh-access-token",
    );
  });

  it("marks the connection needs_reauth on invalid_grant instead of surfacing a generic failure", async () => {
    const cipher = encryptSecret("revoked-refresh-token");
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      status: "active",
      refreshTokenCipher: cipher,
    } as never);
    mockOAuth2Client({
      getAccessToken: jest.fn().mockRejectedValue(new Error("invalid_grant: Token has been expired or revoked.")),
    });
    mockPrisma.googleConnection.update.mockResolvedValue({} as never);

    await expect(service.getValidAccessToken(USER_ID)).rejects.toMatchObject({
      code: "GOOGLE_NEEDS_REAUTH",
    });
    expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { status: "needs_reauth", lastError: "invalid_grant" },
    });
  });
});

describe("disconnect", () => {
  it("does nothing when there is no connection", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(null);

    await service.disconnect(USER_ID);

    expect(mockPrisma.googleConnection.delete).not.toHaveBeenCalled();
  });

  it("revokes at Google, then clears the local row and cached token", async () => {
    const cipher = encryptSecret("token-to-revoke");
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      refreshTokenCipher: cipher,
    } as never);
    redisStore.set(`google-oauth:access-token:${USER_ID}`, "cached");
    const client = mockOAuth2Client();
    mockPrisma.googleConnection.delete.mockResolvedValue({} as never);

    await service.disconnect(USER_ID);

    expect(client.revokeToken).toHaveBeenCalledWith("token-to-revoke");
    expect(mockPrisma.googleConnection.delete).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(redisStore.has(`google-oauth:access-token:${USER_ID}`)).toBe(false);
  });

  it("still clears the local row when Google's revoke call fails", async () => {
    const cipher = encryptSecret("already-revoked");
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      refreshTokenCipher: cipher,
    } as never);
    mockOAuth2Client({ revokeToken: jest.fn().mockRejectedValue(new Error("already revoked")) });
    mockPrisma.googleConnection.delete.mockResolvedValue({} as never);
    jest.spyOn(console, "error").mockImplementation(() => {});

    await service.disconnect(USER_ID);

    expect(mockPrisma.googleConnection.delete).toHaveBeenCalledWith({ where: { userId: USER_ID } });
  });
});
