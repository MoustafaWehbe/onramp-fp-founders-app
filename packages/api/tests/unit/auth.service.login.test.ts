import { AuthService } from "../../src/services/auth.service";
import { verifyPassword } from "../../src/utils/auth";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    refreshToken: { create: jest.fn(), updateMany: jest.fn() },
    startupMember: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/utils/auth", () => ({
  ...jest.requireActual("../../src/utils/auth"),
  verifyPassword: jest.fn(),
  generateAccessToken: jest.fn(() => "access.jwt"),
  generateRefreshToken: jest.fn(() => ({ raw: "refresh.raw", hash: "refresh.hash" })),
}));

jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

import { prisma } from "../../src/db/prisma";
import { OAuth2Client } from "google-auth-library";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const service = new AuthService();

const USER = {
  id: "user-1",
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Smith",
  passwordHash: "$2a$12$hash",
  authProvider: "local",
  googleId: null,
  avatarUrl: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  mockPrisma.refreshToken.create.mockResolvedValue({} as never);
});

describe("AuthService.login", () => {
  it("returns user and tokens for valid credentials", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(USER as never);
    mockVerifyPassword.mockResolvedValue(true);

    const result = await service.login({ email: USER.email, password: "SecurePass1" });

    expect(result.user.email).toBe(USER.email);
    expect(result.accessToken).toBe("access.jwt");
    expect(result.refreshToken).toBe("refresh.raw");
    expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
  });

  it("throws INVALID_CREDENTIALS when user is not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ email: "missing@example.com", password: "x" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials",
    });
  });

  it("throws INVALID_CREDENTIALS when password is wrong", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(USER as never);
    mockVerifyPassword.mockResolvedValue(false);

    await expect(service.login({ email: USER.email, password: "wrong" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
    });
  });

  it("throws GOOGLE_ACCOUNT for Google-only users", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...USER,
      authProvider: "google",
      passwordHash: null,
    } as never);

    await expect(service.login({ email: USER.email, password: "x" })).rejects.toMatchObject({
      statusCode: 400,
      code: "GOOGLE_ACCOUNT",
    });
  });
});

describe("AuthService.googleAuth", () => {
  const payload = {
    sub: "google-sub-123",
    email: "google@example.com",
    email_verified: true,
    given_name: "Google",
    family_name: "User",
    picture: "https://example.com/avatar.png",
  };

  function mockGoogleVerify(): jest.Mock {
    const verifyIdToken = jest.fn().mockResolvedValue({ getPayload: () => payload });
    (OAuth2Client as jest.Mock).mockImplementation(() => ({ verifyIdToken }));
    return verifyIdToken;
  }

  it("logs in returning Google user by googleId", async () => {
    mockGoogleVerify();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", email: payload.email, firstName: "G", lastName: "U" } as never);

    const result = await service.googleAuth({ idToken: "token" });

    expect(result.isNewUser).toBe(false);
    expect(result.user.email).toBe(payload.email);
  });

  it("links account when user exists by email without googleId", async () => {
    mockGoogleVerify();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "u2", email: payload.email, firstName: "E", lastName: "U", googleId: null, avatarUrl: null } as never);
    mockPrisma.user.update.mockResolvedValue({
      id: "u2",
      email: payload.email,
      firstName: "E",
      lastName: "U",
    } as never);

    const result = await service.googleAuth({ idToken: "token" });

    expect(result.isNewUser).toBe(false);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ googleId: payload.sub, authProvider: "both" }),
      }),
    );
  });

  it("creates new user and accepts pending invites", async () => {
    mockGoogleVerify();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (fn) =>
      fn({
        user: {
          create: jest.fn().mockResolvedValue({
            id: "new-user",
            email: payload.email,
            firstName: "Google",
            lastName: "User",
          }),
        },
        startupMember: {
          findMany: jest.fn().mockResolvedValue([{ id: "invite-1", startupId: "startup-1" }]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }),
    );

    const result = await service.googleAuth({ idToken: "token" });

    expect(result.isNewUser).toBe(true);
    expect(result.user.id).toBe("new-user");
  });

  it("throws EMAIL_NOT_VERIFIED when Google email is not verified", async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => ({ ...payload, email_verified: false }),
    });
    (OAuth2Client as jest.Mock).mockImplementation(() => ({ verifyIdToken }));

    await expect(service.googleAuth({ idToken: "token" })).rejects.toMatchObject({
      statusCode: 401,
      code: "EMAIL_NOT_VERIFIED",
    });
  });

  it("throws INVALID_GOOGLE_TOKEN when verification fails", async () => {
    const verifyIdToken = jest.fn().mockRejectedValue(new Error("bad token"));
    (OAuth2Client as jest.Mock).mockImplementation(() => ({ verifyIdToken }));

    await expect(service.googleAuth({ idToken: "bad" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_GOOGLE_TOKEN",
    });
  });
});

describe("AuthService.logout", () => {
  it("revokes all tokens in the session family", async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 } as never);

    await service.logout("user-1", "family-123");

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "family-123", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
