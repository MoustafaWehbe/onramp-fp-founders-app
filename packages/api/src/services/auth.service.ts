import crypto from "crypto";
import {
  hashPassword,
  verifyPassword,
  generateTokenPair,
  verifyRefreshToken,
} from "../utils/auth";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";

interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export class AuthService {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw createError("Email already in use", 409);

    const passwordHash = await hashPassword(input.password);
    return prisma.user.create({
      data: { email: input.email, passwordHash, name: input.name },
      select: { id: true, email: true, name: true, role: true },
    });
  }

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw createError("Invalid credentials", 401);

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) throw createError("Invalid credentials", 401);

    const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        expiresAt,
      },
    });

    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    });

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        tokenHash: sha256(tokens.refreshToken),
        expiresAt,
      },
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    };
  }

  async refresh(rawToken: string) {
    const tokenHash = sha256(rawToken);
    const now = new Date();

    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < now) {
      throw createError("Invalid or expired refresh token", 401);
    }

    const payload = verifyRefreshToken(rawToken);

    const [user, session] = await Promise.all([
      prisma.user.findUnique({ where: { id: payload.userId } }),
      prisma.session.findUnique({ where: { id: stored.sessionId } }),
    ]);

    if (!user) throw createError("User not found", 404);
    if (!session) throw createError("Session not found", 401);

    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    });

    const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          sessionId: session.id,
          tokenHash: sha256(tokens.refreshToken),
          expiresAt,
        },
      }),
    ]);

    return tokens;
  }

  async logout(sessionId: string) {
    // Cascade delete on Session removes all RefreshTokens automatically
    await prisma.session.delete({ where: { id: sessionId } });
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });
    if (!user) throw createError("User not found", 404);
    return user;
  }
}

export const authService = new AuthService();
