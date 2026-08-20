import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";
import { verifyAccessToken } from "../utils/auth";
import type { JwtPayload, Member } from "../types";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      member?: Member;
    }
  }
}

function clearAuthCookies(res: Response): void {
  res.clearCookie("accessToken", { path: "/api/v1" });
  res.clearCookie("refreshToken", { path: "/api/v1/auth/refresh" });
}

async function hasActiveSession(user: JwtPayload): Promise<boolean> {
  const session = await prisma.refreshToken.findFirst({
    where: {
      userId: user.userId,
      familyId: user.sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  return session !== null;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.accessToken as string | undefined;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let user: JwtPayload;
  try {
    user = verifyAccessToken(token);
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ error: "Token expired or invalid" });
    return;
  }

  try {
    if (!(await hasActiveSession(user))) {
      clearAuthCookies(res);
      res.status(401).json({ error: "Authentication required" });
      return;
    }
  } catch (error) {
    next(error);
    return;
  }

  req.user = user;
  next();
}

/**
 * Populates req.user when a valid session cookie is present and does nothing
 * otherwise. For endpoints that must be reachable signed-out but still need to
 * know who is asking accepting an invitation is the case in point: a stranger
 * holding the link must not be able to act as the invited person.
 */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.accessToken as string | undefined;

  if (token) {
    let user: JwtPayload;
    try {
      user = verifyAccessToken(token);
    } catch {
      // An expired or invalid cookie is treated exactly like no cookie at all.
      next();
      return;
    }

    try {
      if (await hasActiveSession(user)) req.user = user;
    } catch (error) {
      next(error);
      return;
    }
  }

  next();
}
