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

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export async function listAuditLogs(
  startupId: string,
  params?: { page?: number; limit?: number; search?: string; entityType?: string },
) {
  const { data } = await apiClient.get<{ data: AuditLogEntry[]; meta: PaginationMeta }>(
    `/startups/${startupId}/audit-logs`,
    { params },
  );
  return data;
}

export async function exportAuditLogsCsv(
  startupId: string,
  params?: { search?: string; entityType?: string },
) {
  const { data } = await apiClient.get<string>(`/startups/${startupId}/audit-logs/export`, {
    params,
    responseType: "text",
  });
  return data;
}
