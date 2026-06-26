import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { JwtPayload, TokenPair } from "../types";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function getSecret(envKey: string, fallback: string): string {
  const value = process.env[envKey];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required env var: ${envKey}`);
  }
  return value ?? fallback;
}

export function signAccessToken(payload: JwtPayload): string {
  const secret = getSecret("JWT_SECRET", "dev-access-secret");
  const expiresIn = process.env.JWT_EXPIRES_IN ?? "15m";
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

export function signRefreshToken(payload: Pick<JwtPayload, "userId">): string {
  const secret = getSecret("JWT_REFRESH_SECRET", "dev-refresh-secret");
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN ?? "7d";
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  const secret = getSecret("JWT_SECRET", "dev-access-secret");
  return jwt.verify(token, secret) as JwtPayload;
}

export function verifyRefreshToken(token: string): Pick<JwtPayload, "userId"> {
  const secret = getSecret("JWT_REFRESH_SECRET", "dev-refresh-secret");
  return jwt.verify(token, secret) as Pick<JwtPayload, "userId">;
}

export function generateTokenPair(payload: JwtPayload): TokenPair {
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken({ userId: payload.userId }),
  };
}
