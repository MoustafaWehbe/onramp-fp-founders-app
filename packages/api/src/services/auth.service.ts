import crypto from "crypto";
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} from "../utils/auth";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";

interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export class AuthService {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw createError("Email already in use", 409);

    const passwordHash = await hashPassword(input.password);
    return prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
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

    const payload = verifyRefreshToken(rawToken);

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
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
