import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

/**
 * Common verbs, kept as constants so call sites don't drift into synonyms
 * ("delete" vs "remove") that would silently split one action into two
 * buckets in the audit UI. New actions don't need an entry here — an
 * unrecognized string still writes fine, it just renders with a generic
 * icon on the Audit page (see web's audit-meta.ts).
 */
export const AUDIT_ACTIONS = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  REVOKE: "revoke",
  ARCHIVE: "archive",
  LOGIN: "login",
  LOGOUT: "logout",
  ACCEPT: "accept",
  DECLINE: "decline",
  SHARE: "share",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});

type RecordAuditInput = {
  startupId: string;
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  changes?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
};

/**
 * Best-effort audit writer. Never throws into the request path — a failed
 * audit insert must not roll back the business mutation.
 */
export async function recordAuditEvent(input: RecordAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        startupId: input.startupId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        changes: input.changes ?? Prisma.JsonNull,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (error) {
    logger.error(
      { entityType: input.entityType, action: input.action, err: error },
      "[audit] failed to record event",
    );
  }
}

/**
 * Account-level events (signing in, signing out, changing a password) aren't
 * scoped to one startup, but `audit_logs.startup_id` is required — so the
 * event is written once per startup the user is currently an active member
 * of. Someone on three cap tables sees "you logged in" on all three; that's
 * the intended fan-out, not a bug.
 */
export async function recordAccountAuditEvent(
  input: Omit<RecordAuditInput, "startupId">,
): Promise<void> {
  try {
    const memberships = await prisma.startupMember.findMany({
      where: { userId: input.userId, status: "active" },
      select: { startupId: true },
    });

    await Promise.all(
      memberships.map((membership) => recordAuditEvent({ ...input, startupId: membership.startupId })),
    );
  } catch (error) {
    logger.error(
      { entityType: input.entityType, action: input.action, err: error },
      "[audit] failed to resolve memberships for account event",
    );
  }
}
