import { apiClient } from "./api-client";

export type AuditLogEntry = {
  id: string;
  startupId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
  changes: unknown;
  ipAddress: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
};

export type AuditLogFacets = {
  actions: string[];
  entityTypes: string[];
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type AuditLogFilters = {
  page?: number;
  limit?: number;
  search?: string;
  /** Multiple values are joined into a comma-separated list for the API. */
  entityType?: string[];
  action?: string[];
  from?: string;
  to?: string;
};

function toQueryParams(filters?: AuditLogFilters) {
  return {
    page: filters?.page,
    limit: filters?.limit,
    search: filters?.search || undefined,
    entityType: filters?.entityType?.length ? filters.entityType.join(",") : undefined,
    action: filters?.action?.length ? filters.action.join(",") : undefined,
    from: filters?.from || undefined,
    to: filters?.to || undefined,
  };
}

export async function listAuditLogs(startupId: string, filters?: AuditLogFilters) {
  const { data } = await apiClient.get<{ data: AuditLogEntry[]; meta: PaginationMeta }>(
    `/startups/${startupId}/audit-logs`,
    { params: toQueryParams(filters) },
  );
  return data;
}

export async function getAuditLogFacets(startupId: string) {
  const { data } = await apiClient.get<{ data: AuditLogFacets }>(
    `/startups/${startupId}/audit-logs/facets`,
  );
  return data.data;
}

export async function exportAuditLogsCsv(
  startupId: string,
  filters?: Pick<AuditLogFilters, "search" | "entityType" | "action" | "from" | "to">,
) {
  const { data } = await apiClient.get<string>(`/startups/${startupId}/audit-logs/export`, {
    params: toQueryParams(filters),
    responseType: "text",
  });
  return data;
}
