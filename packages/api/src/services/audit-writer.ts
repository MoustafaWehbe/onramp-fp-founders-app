import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

type RecordAuditInput = {
  startupId: string;
  userId: string;
  action: string;
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
    console.error("[audit] failed to record event", {
      entityType: input.entityType,
      action: input.action,
      error: error instanceof Error ? error.message : error,
    });
  }
}
