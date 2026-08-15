import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { ListAuditLogsQuery } from "../validators/audit.schemas";

function detailFromChanges(changes: Prisma.JsonValue | null): string {
  if (changes === null || changes === undefined) return "—";
  if (typeof changes === "string") return changes;
  try {
    return JSON.stringify(changes);
  } catch {
    return "—";
  }
}

export class AuditService {
  async listLogs(startupId: string, query: ListAuditLogsQuery) {
    const { page, limit } = query;

    const where = this.buildWhere(startupId, query);

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          startupId: true,
          action: true,
          entityType: true,
          entityId: true,
          changes: true,
          ipAddress: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.serialize(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async exportCsv(
    startupId: string,
    query: Pick<ListAuditLogsQuery, "search" | "entityType" | "action" | "from" | "to">,
  ) {
    const where = this.buildWhere(startupId, query);
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10_000,
      select: {
        id: true,
        startupId: true,
        action: true,
        entityType: true,
        entityId: true,
        changes: true,
        ipAddress: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    const header = ["when", "user", "email", "action", "entityType", "entityId", "detail", "ip"];
    const lines = [header.join(",")];
    for (const row of rows) {
      const serialized = this.serialize(row);
      lines.push(
        [
          serialized.createdAt.toISOString(),
          csvEscape(serialized.user.name),
          csvEscape(serialized.user.email),
          csvEscape(serialized.action),
          csvEscape(serialized.entityType),
          csvEscape(serialized.entityId),
          csvEscape(serialized.detail),
          csvEscape(serialized.ipAddress ?? ""),
        ].join(","),
      );
    }
    return lines.join("\n");
  }

  /** Distinct action/entityType values actually present, to populate filter menus. */
  async facets(startupId: string) {
    const [actions, entityTypes] = await Promise.all([
      prisma.auditLog.findMany({
        where: { startupId },
        select: { action: true },
        distinct: ["action"],
      }),
      prisma.auditLog.findMany({
        where: { startupId },
        select: { entityType: true },
        distinct: ["entityType"],
      }),
    ]);
    return {
      actions: actions.map((row) => row.action).sort(),
      entityTypes: entityTypes.map((row) => row.entityType).sort(),
    };
  }

  private buildWhere(
    startupId: string,
    params: Pick<ListAuditLogsQuery, "search" | "entityType" | "action" | "from" | "to">,
  ): Prisma.AuditLogWhereInput {
    const { search, entityType, action, from, to } = params;
    const entityTypes = entityType?.split(",").map((v) => v.trim()).filter(Boolean);
    const actions = action?.split(",").map((v) => v.trim()).filter(Boolean);

    return {
      startupId,
      ...(entityTypes?.length ? { entityType: { in: entityTypes } } : {}),
      ...(actions?.length ? { action: { in: actions } } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search, mode: "insensitive" } },
              { entityType: { contains: search, mode: "insensitive" } },
              { entityId: { contains: search, mode: "insensitive" } },
              {
                user: {
                  OR: [
                    { firstName: { contains: search, mode: "insensitive" } },
                    { lastName: { contains: search, mode: "insensitive" } },
                    { email: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            ],
          }
        : {}),
    };
  }

  private serialize(row: {
    id: string;
    startupId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes: Prisma.JsonValue | null;
    ipAddress: string | null;
    createdAt: Date;
    user: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    };
  }) {
    const name = `${row.user.firstName ?? ""} ${row.user.lastName ?? ""}`.trim();
    return {
      id: row.id,
      startupId: row.startupId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      detail: detailFromChanges(row.changes),
      changes: row.changes,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
      user: {
        id: row.user.id,
        name: name || row.user.email,
        email: row.user.email,
      },
    };
  }
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export const auditService = new AuditService();
