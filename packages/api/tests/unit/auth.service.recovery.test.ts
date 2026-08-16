import { AuthService } from "../../src/services/auth.service";
import { hashPassword } from "../../src/utils/auth";

// eslint-disable-next-line
const crypto = require("crypto");
function hashToken(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    refreshToken: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    passwordReset: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    pendingRegistration: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    startupMember: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/utils/auth", () => ({
  ...jest.requireActual("../../src/utils/auth"),
  verifyPassword: jest.fn(),
  generateAccessToken: jest.fn(() => "access.jwt"),
  generateRefreshToken: jest.fn(() => ({ raw: "refresh.raw", hash: "refresh.hash" })),
  hashPassword: jest.fn().mockResolvedValue("$2a$12$mockedHash"),
  hashOTP: jest.fn(),
}));

jest.mock("../../src/services/email.service", () => ({
  sendOTP: jest.fn().mockResolvedValue(undefined),
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

import { prisma } from "../../src/db/prisma";
import { sendPasswordReset } from "../../src/services/email.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSendPasswordReset = sendPasswordReset as any;
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

const STORED_TOKEN = {
  id: "rt-1",
  userId: "user-1",
  tokenHash: hashToken("valid-refresh-token"),
  familyId: "family-123",
  revokedAt: null,
  deviceInfo: "Mozilla/5.0",
  ipAddress: "127.0.0.1",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
};

const STORED_TOKEN_EXPIRED = {
  ...STORED_TOKEN,
  id: "rt-expired",
  tokenHash: hashToken("expired-refresh-token"),
  familyId: "family-expired",
  expiresAt: new Date(Date.now() - 1000),
};

const STORED_TOKEN_REVOKED = {
  ...STORED_TOKEN,
  id: "rt-revoked",
  tokenHash: hashToken("revoked-refresh-token"),
  familyId: "family-revoked",
  revokedAt: new Date(Date.now() - 1000),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.refreshToken.create.mockResolvedValue({} as never);
  mockPrisma.refreshToken.update.mockResolvedValue({} as never);
  (hashPassword as jest.Mock).mockResolvedValue("$2a$12$mockedHash");
});

// ─── refresh ────────────────────────────────────────────────────────────────

describe("AuthService.refresh", () => {
  it("rotates tokens in a transaction when token is valid", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(STORED_TOKEN as never);
    mockPrisma.user.findUnique.mockResolvedValue(USER as never);
    mockPrisma.refreshToken.create.mockResolvedValue({ id: "rt-2" } as never);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops;
      return (ops as (tx: unknown) => unknown)(mockPrisma);
    });

    const result = await service.refresh("valid-refresh-token");

    expect(result.accessToken).toBe("access.jwt");
    expect(result.refreshToken).toBe("refresh.raw");
  });

  it("revokes old token and creates new one in the same family", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(STORED_TOKEN as never);
    mockPrisma.user.findUnique.mockResolvedValue(USER as never);
    mockPrisma.refreshToken.create.mockResolvedValue({ id: "rt-2" } as never);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops;
      return (ops as (tx: unknown) => unknown)(mockPrisma);
    });

    await service.refresh("valid-refresh-token");

    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rt-1" },
        data: { revokedAt: expect.any(Date), replacedById: "rt-2" },
      }),
    );
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: "family-123",
          tokenHash: "refresh.hash",
        }),
      }),
    );
  });

  it("throws INVALID_TOKEN when token is not found", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.refresh("nonexistent")).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_TOKEN",
      message: "Invalid refresh token",
    });
  });

  it("throws TOKEN_EXPIRED when token is past its expiry", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(STORED_TOKEN_EXPIRED as never);

    await expect(service.refresh("expired-refresh-token")).rejects.toMatchObject({
      statusCode: 401,
      code: "TOKEN_EXPIRED",
    });
  });

  it("revokes entire family on replay attack and throws TOKEN_REUSE_DETECTED", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(STORED_TOKEN_REVOKED as never);
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 } as never);

    await expect(service.refresh("revoked-refresh-token")).rejects.toMatchObject({
      statusCode: 401,
      code: "TOKEN_REUSE_DETECTED",
    });

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "family-revoked", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("follows the rotation chain instead of revoking when the old token was reused within the grace window", async () => {
    const replacement = { ...STORED_TOKEN, id: "rt-2", revokedAt: null };
    const raced = {
      ...STORED_TOKEN,
      id: "rt-1",
      revokedAt: new Date(Date.now() - 2_000),
      replacedById: "rt-2",
    };
    mockPrisma.refreshToken.findUnique.mockImplementation(({ where }: { where: { tokenHash?: string; id?: string } }) => {
      if (where.id === "rt-2") return Promise.resolve(replacement);
      return Promise.resolve(raced);
    });
    mockPrisma.user.findUnique.mockResolvedValue(USER as never);
    mockPrisma.refreshToken.create.mockResolvedValue({ id: "rt-3" } as never);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops;
      return (ops as (tx: unknown) => unknown)(mockPrisma);
    });

    const result = await service.refresh("valid-refresh-token");

    expect(result.accessToken).toBe("access.jwt");
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rt-2" },
        data: { revokedAt: expect.any(Date), replacedById: "rt-3" },
      }),
    );
  });

  it("treats a reuse outside the grace window as a replay attack even with a successor to follow", async () => {
    const raced = {
      ...STORED_TOKEN_REVOKED,
      revokedAt: new Date(Date.now() - 60_000),
      replacedById: "rt-2",
    };
    mockPrisma.refreshToken.findUnique.mockResolvedValue(raced as never);
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 } as never);

    await expect(service.refresh("revoked-refresh-token")).rejects.toMatchObject({
      statusCode: 401,
      code: "TOKEN_REUSE_DETECTED",
    });

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "family-revoked", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("throws 404 when user is not found", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      ...STORED_TOKEN,
      userId: "deleted-user",
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.refresh("valid-refresh-token")).rejects.toMatchObject({
      statusCode: 404,
      message: "User not found",
    });
  });
});

// ─── forgotPassword ─────────────────────────────────────────────────────────

describe("AuthService.forgotPassword", () => {
  it("returns 200 with generic message when email is not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await service.forgotPassword({ email: "nobody@example.com" });

    expect(result).toEqual({
      message: "If an account exists with that email, a password reset link has been sent.",
    });
    expect(mockPrisma.passwordReset.create).not.toHaveBeenCalled();
  });

  it("returns 200 with generic message for Google-only users", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...USER,
      authProvider: "google",
      passwordHash: null,
    } as never);

    const result = await service.forgotPassword({ email: USER.email });

    expect(result).toEqual({
      message: "If an account exists with that email, a password reset link has been sent.",
    });
    expect(mockPrisma.passwordReset.create).not.toHaveBeenCalled();
  });

  it("creates a passwordReset and sends email for valid email/password user", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...USER,
      authProvider: "local",
      passwordHash: "$2a$12$hash",
    } as never);
    mockPrisma.passwordReset.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.passwordReset.create.mockResolvedValue({ id: "pr-1" } as never);

    const result = await service.forgotPassword({ email: USER.email });

    expect(result).toEqual({
      message: "If an account exists with that email, a password reset link has been sent.",
    });

    expect(mockPrisma.passwordReset.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER.id },
    });

    expect(mockPrisma.passwordReset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER.id,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      }),
    );

    expect(mockSendPasswordReset).toHaveBeenCalledWith(USER.email, USER.firstName, expect.any(String));
  });

  it("returns the same message for both existing and non-existing emails", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const notFound = await service.forgotPassword({ email: "x@x.com" });

    mockPrisma.user.findUnique.mockResolvedValue({
      ...USER,
      authProvider: "local",
      passwordHash: "$2a$12$hash",
    } as never);
    mockPrisma.passwordReset.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.passwordReset.create.mockResolvedValue({} as never);
    const found = await service.forgotPassword({ email: USER.email });

    expect(notFound.message).toBe(found.message);
  });
});

// ─── resetPassword ──────────────────────────────────────────────────────────

describe("AuthService.resetPassword", () => {
  const RESET = {
    id: "pr-1",
    userId: "user-1",
    tokenHash: hashToken("valid-reset-token"),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    usedAt: null,
  };

  it("updates password and revokes sessions on success", async () => {
    mockPrisma.passwordReset.findUnique.mockResolvedValue(RESET as never);
    mockPrisma.user.update.mockResolvedValue({} as never);
    mockPrisma.passwordReset.update.mockResolvedValue({} as never);
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 } as never);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops;
      return ops;
    });

    const result = await service.resetPassword({
      token: "valid-reset-token",
      new_password: "NewStrongPass1",
    });

    expect(result).toEqual({
      message: "Password reset successful. Please log in with your new password.",
    });

    expect(hashPassword).toHaveBeenCalledWith("NewStrongPass1");
  });

  it("sets authProvider to 'both' when user was Google-only", async () => {
    mockPrisma.passwordReset.findUnique.mockResolvedValue(RESET as never);
    mockPrisma.user.findUnique.mockResolvedValue({ authProvider: "google" } as never);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops;
      return ops;
    });

    await service.resetPassword({
      token: "valid-reset-token",
      new_password: "NewStrongPass1",
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passwordHash: "$2a$12$mockedHash",
          authProvider: "both",
        }),
      }),
    );
  });

  it("preserves authProvider for local accounts", async () => {
    mockPrisma.passwordReset.findUnique.mockResolvedValue(RESET as never);
    mockPrisma.user.findUnique.mockResolvedValue({ authProvider: "local" } as never);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops;
      return ops;
    });

    await service.resetPassword({
      token: "valid-reset-token",
      new_password: "NewStrongPass1",
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ authProvider: expect.anything() }),
      }),
    );
  });

  it("revokes all active refresh tokens on password change", async () => {
    mockPrisma.passwordReset.findUnique.mockResolvedValue(RESET as never);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops;
      return ops;
    });

    await service.resetPassword({
      token: "valid-reset-token",
      new_password: "NewStrongPass1",
    });

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: RESET.userId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("throws INVALID_TOKEN when token is not found", async () => {
    mockPrisma.passwordReset.findUnique.mockResolvedValue(null);

    await expect(
      service.resetPassword({ token: "bad-token", new_password: "NewPass1234" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_TOKEN",
    });
  });

  it("throws TOKEN_ALREADY_USED when token has been consumed", async () => {
    mockPrisma.passwordReset.findUnique.mockResolvedValue({
      ...RESET,
      usedAt: new Date(),
    } as never);

    await expect(
      service.resetPassword({ token: "valid-reset-token", new_password: "NewPass1234" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "TOKEN_ALREADY_USED",
    });
  });

  it("throws TOKEN_EXPIRED when token is past its 15-min TTL", async () => {
    mockPrisma.passwordReset.findUnique.mockResolvedValue({
      ...RESET,
      expiresAt: new Date(Date.now() - 1000),
    } as never);

    await expect(
      service.resetPassword({ token: "valid-reset-token", new_password: "NewPass1234" }),
    ).rejects.toMatchObject({
      statusCode: 410,
      code: "TOKEN_EXPIRED",
    });
  });
});

describe("AuthService.registerResend", () => {
  const PENDING = {
    id: "pending-1",
    firstName: "Alice",
    lastName: "Smith",
    email: "alice@example.com",
    passwordHash: "$2a$12$hash",
    otpHash: "old-otp-hash",
    otpExpiresAt: new Date(Date.now() + 600_000),
    attempts: 4,
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reissues a code without resetting the failed-attempt count", async () => {
    mockPrisma.pendingRegistration.findUnique.mockResolvedValue(PENDING as never);
    mockPrisma.pendingRegistration.update.mockResolvedValue(PENDING as never);

    await service.registerResend(PENDING.email);

    // Updating in place is what preserves `attempts`. Deleting and recreating
    // the row would silently reset it to 0 and reopen the guessing budget.
    expect(mockPrisma.pendingRegistration.delete).not.toHaveBeenCalled();
    expect(mockPrisma.pendingRegistration.create).not.toHaveBeenCalled();

    const [[call]] = mockPrisma.pendingRegistration.update.mock.calls;
    expect(call.where).toEqual({ email: PENDING.email });
    expect(call.data).not.toHaveProperty("attempts");
    expect(call.data.otpHash).toBeDefined();
  });

  it("refuses to reissue once the attempt cap is reached", async () => {
    mockPrisma.pendingRegistration.findUnique.mockResolvedValue({
      ...PENDING,
      attempts: 5,
    } as never);

    await expect(service.registerResend(PENDING.email)).rejects.toMatchObject({
      statusCode: 429,
      code: "TOO_MANY_ATTEMPTS",
    });
    expect(mockPrisma.pendingRegistration.update).not.toHaveBeenCalled();
  });

  it("answers the same way when no registration is pending, to avoid leaking whether one exists", async () => {
    mockPrisma.pendingRegistration.findUnique.mockResolvedValue(null);

    const result = await service.registerResend("nobody@example.com");

    expect(result.email).toBe("nobody@example.com");
    expect(mockPrisma.pendingRegistration.update).not.toHaveBeenCalled();
  });
});
