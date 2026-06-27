import crypto from "crypto";
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  generateOTP,
  hashToken,
  hashOTP,
} from "../utils/auth";
import { sendOTP } from "./email.service";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";

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
    if (!user) throw createError("Invalid credentials", 401);
    if (!user.passwordHash) throw createError("Invalid credentials", 401);

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) throw createError("Invalid credentials", 401);

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
    if (!stored || stored.revokedAt || stored.expiresAt < now) {
      throw createError("Invalid or expired refresh token", 401);
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
