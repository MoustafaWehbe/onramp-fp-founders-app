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
