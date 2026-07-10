import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  generateOTP,
  hashToken,
  hashOTP,
} from "../utils/auth";
import { sendOTP, sendPasswordReset } from "./email.service";
import { prisma } from "../db/prisma";
import { createError, type AppError } from "../utils/errors";

const USER_SELECT = { id: true, email: true, firstName: true, lastName: true } as const;

interface RegisterInitiateInput {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}

interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

const OTP_TTL_MS = 10 * 60 * 1_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_OTP_ATTEMPTS = 5;

export class AuthService {
  async registerVerify(
    input: { email: string; otp: string },
    meta: { userAgent?: string; ipAddress?: string },
  ) {
    const pending = await prisma.pendingRegistration.findUnique({ where: { email: input.email } });
    if (!pending) throw createError("Invalid or expired verification code", 400, "INVALID_OTP");

    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      throw createError("Too many failed attempts. Please register again.", 429, "TOO_MANY_ATTEMPTS");
    }

    if (pending.otpExpiresAt < new Date()) {
      throw createError("Verification code has expired", 410, "OTP_EXPIRED");
    }

    if (hashOTP(input.otp) !== pending.otpHash) {
      await prisma.pendingRegistration.update({
        where: { email: input.email },
        data: { attempts: { increment: 1 } },
      });
      throw createError("Invalid verification code", 400, "INVALID_OTP");
    }

    const [user] = await prisma.$transaction([
      prisma.user.create({
        data: {
          firstName: pending.firstName,
          lastName: pending.lastName,
          email: pending.email,
          passwordHash: pending.passwordHash,
          authProvider: "local",
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
      prisma.pendingRegistration.delete({ where: { email: input.email } }),
    ]);

    const familyId = crypto.randomUUID();
    const { raw: rawRefresh, hash: refreshHash } = generateRefreshToken();
    const accessToken = generateAccessToken(user.id, familyId, user.email);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        familyId,
        deviceInfo: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
      },
    });

    return { user, accessToken, refreshToken: rawRefresh };
  }

  async registerResend(email: string) {
    const pending = await prisma.pendingRegistration.findUnique({ where: { email } });
    if (!pending) {
      return {
        message: `Verification code sent to ${email}`,
        email,
        expires_in_seconds: OTP_TTL_MS / 1_000,
      };
    }

    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      throw createError("Too many failed attempts. Please register again.", 429, "TOO_MANY_ATTEMPTS");
    }

    const { raw: rawOtp, hash: otpHash } = generateOTP();

    await prisma.pendingRegistration.delete({ where: { email } });
    await prisma.pendingRegistration.create({
      data: {
        firstName: pending.firstName,
        lastName: pending.lastName,
        email,
        passwordHash: pending.passwordHash,
        otpHash,
        otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    await sendOTP(email, pending.firstName, rawOtp);

    return {
      message: `Verification code sent to ${email}`,
      email,
      expires_in_seconds: OTP_TTL_MS / 1_000,
    };
  }

  async registerInitiate(input: RegisterInitiateInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      return {
        message: `Verification code sent to ${input.email}`,
        email: input.email,
        expires_in_seconds: OTP_TTL_MS / 1_000,
      };
    }

    await prisma.pendingRegistration.deleteMany({ where: { email: input.email } });

    const [passwordHash, { raw: rawOtp, hash: otpHash }] = await Promise.all([
      hashPassword(input.password),
      Promise.resolve(generateOTP()),
    ]);

    await prisma.pendingRegistration.create({
      data: {
        firstName: input.first_name,
        lastName: input.last_name,
        email: input.email,
        passwordHash,
        otpHash,
        otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    await sendOTP(input.email, input.first_name, rawOtp);

    return {
      message: `Verification code sent to ${input.email}`,
      email: input.email,
      expires_in_seconds: OTP_TTL_MS / 1_000,
    };
  }

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw createError("Invalid credentials", 401, "INVALID_CREDENTIALS");

    if (user.authProvider === "google" && !user.passwordHash) {
      throw createError(
        "This account uses Google sign-in. Please continue with Google.",
        400,
        "GOOGLE_ACCOUNT",
      );
    }

    if (!user.passwordHash) throw createError("Invalid credentials", 401, "INVALID_CREDENTIALS");

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) throw createError("Invalid credentials", 401, "INVALID_CREDENTIALS");

    const familyId = crypto.randomUUID();
    const { raw: rawRefresh, hash: refreshHash } = generateRefreshToken();
    const accessToken = generateAccessToken(user.id, familyId, user.email);
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        familyId,
        deviceInfo: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        expiresAt,
      },
    });

    return {
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      accessToken,
      refreshToken: rawRefresh,
    };
  }

  async refresh(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) {
      throw createError("Invalid refresh token", 401, "INVALID_TOKEN");
    }

    // REPLAY ATTACK DETECTION — if token was already revoked, revoke entire family
    if (stored.revokedAt !== null) {
      if (stored.familyId) {
        await prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else {
        // No familyId — fall back to revoking all sessions for this user
        await prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw createError(
        "Security alert: token reuse detected. All sessions revoked.",
        401,
        "TOKEN_REUSE_DETECTED",
      );
    }

    if (stored.expiresAt < now) {
      throw createError("Refresh token has expired. Please log in again.", 401, "TOKEN_EXPIRED");
    }

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) throw createError("User not found", 404);

    const familyId = stored.familyId ?? crypto.randomUUID();
    const { raw: rawRefresh, hash: refreshHash } = generateRefreshToken();
    const accessToken = generateAccessToken(user.id, familyId, user.email);
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refreshHash,
          familyId,
          deviceInfo: stored.deviceInfo,
          ipAddress: stored.ipAddress,
          expiresAt,
        },
      }),
    ]);

    return { accessToken, refreshToken: rawRefresh };
  }
  async forgotPassword(input: { email: string }) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    // Always return 200 — prevent email enumeration
    if (!user) {
      return {
        message: "If an account exists with that email, a password reset link has been sent.",
      };
    }

    // If Google-only user, still return 200 (don't reveal auth method)
    if (user.authProvider === "google" && !user.passwordHash) {
      return {
        message: "If an account exists with that email, a password reset link has been sent.",
      };
    }

    // Generate reset token
    const raw = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(raw);

    // Delete any existing active resets for this user
    await prisma.passwordReset.deleteMany({ where: { userId: user.id } });

    // Insert new reset
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1_000), // 15 min TTL
      },
    });

    // Send email with reset link
    const resetUrl = `${process.env.CORS_ORIGIN}/auth/reset-password?token=${raw}`;
    try {
      await sendPasswordReset(user.email, user.firstName, resetUrl);
    } catch (err) {
      console.error("[forgotPassword] email enqueue failed:", err);
    }

    return {
      message: "If an account exists with that email, a password reset link has been sent.",
    };
  }

  async resetPassword(input: { token: string; new_password: string }) {
    const tokenHash = hashToken(input.token);
    const now = new Date();

    const reset = await prisma.passwordReset.findUnique({ where: { tokenHash } });
    if (!reset) {
      throw createError("Invalid or expired reset token", 400, "INVALID_TOKEN");
    }

    if (reset.usedAt !== null) {
      throw createError("This reset link has already been used", 400, "TOKEN_ALREADY_USED");
    }

    if (reset.expiresAt < now) {
      throw createError("This reset link has expired", 410, "TOKEN_EXPIRED");
    }

    const user = await prisma.user.findUnique({
      where: { id: reset.userId },
      select: { authProvider: true },
    });

    const newPasswordHash = await hashPassword(input.new_password);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash: newPasswordHash,
          ...(user?.authProvider === "google" && { authProvider: "both" }),
        },
      }),
      prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: now },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    return {
      message: "Password reset successful. Please log in with your new password.",
    };
  }

  async googleAuth(input: { idToken: string; userAgent?: string; ipAddress?: string }) {
    const clientId = process.env.GOOGLE_CLIENT_ID;

    const client = new OAuth2Client(clientId);
    let payload;

    try {
      const ticket = await client.verifyIdToken({ idToken: input.idToken, audience: clientId });
      payload = ticket.getPayload();
      if (!payload?.email) throw createError("Invalid or expired Google token", 401, "INVALID_GOOGLE_TOKEN");
    } catch (err) {
      if ((err as AppError).isOperational) throw err;
      throw createError("Invalid or expired Google token", 401, "INVALID_GOOGLE_TOKEN");
    }

    if (payload.email_verified !== true) {
      throw createError("Google email not verified", 401, "EMAIL_NOT_VERIFIED");
    }

    let isNewUser = false;
    type AuthUser = { id: string; email: string; firstName: string; lastName: string };
    let user: AuthUser | null = await prisma.user.findUnique({
      where: { googleId: payload.sub },
      select: USER_SELECT,
    });

    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email: payload.email } });
      if (byEmail) {
        if (byEmail.googleId) {
          throw createError("This email is already linked to a different Google account", 409, "ACCOUNT_CONFLICT");
        }
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: payload.sub,
            avatarUrl: byEmail.avatarUrl || payload.picture || null,
            authProvider: "both",
          },
          select: USER_SELECT,
        });
      } else {
        isNewUser = true;
        const firstName = payload.given_name ?? payload.email.split("@")[0] ?? "User";
        const lastName = payload.family_name ?? "";

        user = await prisma.$transaction(async (tx) => {
          const pendingInvites = await tx.startupMember.findMany({
            where: { invitedEmail: payload.email, status: "pending", userId: null },
            orderBy: { createdAt: "asc" },
          });

          const created = await tx.user.create({
            data: {
              firstName,
              lastName,
              email: payload.email!,
              authProvider: "google",
              googleId: payload.sub,
              passwordHash: null,
              emailVerifiedAt: new Date(),
              avatarUrl: payload.picture ?? null,
              ...(pendingInvites.length > 0 && {
                lastActiveStartupId: pendingInvites[0].startupId,
              }),
            },
            select: USER_SELECT,
          });

          if (pendingInvites.length > 0) {
            await tx.startupMember.updateMany({
              where: {
                id: { in: pendingInvites.map((i) => i.id) },
                status: "pending",
                userId: null,
              },
              data: { userId: created.id, status: "active", joinedAt: new Date() },
            });
          }

          return created;
        });
      }
    }

    if (!user) throw createError("Invalid or expired Google token", 401, "INVALID_GOOGLE_TOKEN");

    const familyId = crypto.randomUUID();
    const { raw: rawRefresh, hash: refreshHash } = generateRefreshToken();
    const accessToken = generateAccessToken(user.id, familyId, user.email);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        familyId,
        deviceInfo: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
      },
    });

    return { user, accessToken, refreshToken: rawRefresh, isNewUser };
  }

  async logout(familyId: string) {
    await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });
    if (!user) throw createError("User not found", 404);
    return user;
  }
}

export const authService = new AuthService();
