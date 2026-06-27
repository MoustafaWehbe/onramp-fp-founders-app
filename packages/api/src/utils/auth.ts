import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../types";

const BCRYPT_ROUNDS = 12;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Tokens

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(64).toString("hex");
  return { raw, hash: hashToken(raw) };
}

export function generateAccessToken(userId: string, sessionId: string, email: string): string {
  return jwt.sign(
    { sub: userId, type: "access", sessionId, email },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "15m" },
  );
}

export function verifyAccessToken(token: string): JwtPayload {
  const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
    sub: string;
    type: string;
    sessionId: string;
    email: string;
  };
  if (payload.type !== "access") throw new Error("Invalid token type");
  return { userId: payload.sub, sessionId: payload.sessionId, email: payload.email };
}


// Password

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// OTP

export function generateOTP(): { raw: string; hash: string } {
  const raw = crypto.randomInt(100_000, 999_999).toString();
  return { raw, hash: hashToken(raw) };
}

