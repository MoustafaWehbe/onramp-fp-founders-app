import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/auth";
import type { JwtPayload, UserRole } from "../types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
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
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }

    if (roles.length > 0 && !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}
