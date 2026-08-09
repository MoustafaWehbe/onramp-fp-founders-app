import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/auth";
import type { JwtPayload, Member } from "../types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      member?: Member;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.accessToken as string | undefined;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Token expired or invalid" });
  }
}

/**
 * Populates req.user when a valid session cookie is present and does nothing
 * otherwise. For endpoints that must be reachable signed-out but still need to
 * know who is asking — accepting an invitation is the case in point: a stranger
 * holding the link must not be able to act as the invited person.
 */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.accessToken as string | undefined;

  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // An expired cookie is treated exactly like no cookie at all.
    }
  }

  next();
}
