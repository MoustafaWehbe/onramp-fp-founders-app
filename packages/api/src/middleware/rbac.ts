import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";

export async function requireMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const startupId = req.params.startupId as string | undefined;
    if (!startupId) {
      res.status(400).json({ error: "Missing startupId parameter" });
      return;
    }

    const member = await prisma.startupMember.findUnique({
      where: { startupId_userId: { startupId, userId: req.user!.userId } },
    });

    if (!member || member.status !== "active") {
      res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
      return;
    }

    req.member = {
      id: member.id,
      userId: member.userId!,
      startupId: member.startupId,
      roleId: member.roleId,
      status: member.status,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(resource: string, action: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.member) {
        res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
        return;
      }

      const found = await prisma.rolePermission.findFirst({
        where: {
          roleId: req.member.roleId,
          permission: { resource, action },
        },
        include: { permission: true },
      });

      if (!found) {
        res.status(403).json({ error: "Insufficient permissions", code: "FORBIDDEN" });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
