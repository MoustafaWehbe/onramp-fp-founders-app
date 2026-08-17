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

/** Same check the middleware below runs, exposed for services that need a finer-grained decision than "gate the whole route" (e.g. delete-your-own-message-or-be-a-moderator). */
export async function hasPermission(roleId: string, resource: string, action: string): Promise<boolean> {
  const found = await prisma.rolePermission.findFirst({
    where: { roleId, permission: { resource, action } },
    include: { permission: true },
  });
  return found !== null;
}

export function requirePermission(resource: string, action: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.member) {
        res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
        return;
      }

      if (!(await hasPermission(req.member.roleId, resource, action))) {
        res.status(403).json({ error: "Insufficient permissions", code: "FORBIDDEN" });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
