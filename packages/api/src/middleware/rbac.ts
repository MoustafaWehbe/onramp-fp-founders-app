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

    // The role's grants come back with the membership rather than in a second
    // round trip per gate: a route can carry more than one requirePermission,
    // and controllers (the AI copilot especially) routinely need to branch on
    // several grants at once. One query answers all of them.
    const member = await prisma.startupMember.findUnique({
      where: { startupId_userId: { startupId, userId: req.user!.userId } },
      include: {
        role: {
          select: {
            name: true,
            rolePermissions: { select: { permission: { select: { resource: true, action: true } } } },
          },
        },
      },
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
      roleName: member.role.name,
      status: member.status,
      permissions: new Set(
        member.role.rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
      ),
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

/**
 * A role's complete permission set in one query, as "resource:action" strings.
 * Prefer `req.member.permissions`, which requireMember has already loaded for
 * the request; this exists for callers that hold only a roleId (background
 * jobs, deferred AI-action approval) and have no request context to read from.
 * Never cached — it always reflects the role's current grants.
 */
export async function getRolePermissions(roleId: string): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { resource: true, action: true } } },
  });
  return new Set(rows.map((row) => `${row.permission.resource}:${row.permission.action}`));
}

function deny(res: Response): void {
  res.status(403).json({ error: "Insufficient permissions", code: "FORBIDDEN" });
}

export function requirePermission(resource: string, action: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.member) {
      res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
      return;
    }
    if (!req.member.permissions.has(`${resource}:${action}`)) {
      deny(res);
      return;
    }
    next();
  };
}

/**
 * Passes when the caller holds *any* of the listed grants. For endpoints whose
 * data serves two audiences at different depths — the round list is the
 * pipeline board's scope selector as much as it is the Rounds screen's
 * content — the alternative is either denying the board its own scope or
 * handing out a financial grant nobody meant to give. The handler is then
 * responsible for redacting what the weaker grant does not cover.
 */
export function requireAnyPermission(...keys: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.member) {
      res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
      return;
    }
    if (!keys.some((key) => req.member!.permissions.has(key))) {
      deny(res);
      return;
    }
    next();
  };
}

/** Reads a grant off the request requireMember already resolved. */
export function memberCan(req: Request, resource: string, action: string): boolean {
  return req.member?.permissions.has(`${resource}:${action}`) ?? false;
}
