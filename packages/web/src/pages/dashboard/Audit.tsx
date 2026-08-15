import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ScrollText, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../../components/shared/EmptyState";
import { PageHeader } from "../../components/layout/PageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { useActiveStartupId } from "../../hooks/useWorkspace";
import { apiErrorMessage } from "../../lib/api-error";
import { exportAuditLogsCsv, listAuditLogs } from "../../lib/audit-api";

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function Audit() {
  const startupId = useActiveStartupId();
  const [searchQuery, setSearchQuery] = useState("");
  const [entityType, setEntityType] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const logsQuery = useQuery({
    queryKey: ["audit-logs", startupId, searchQuery, entityType],
    queryFn: () =>
      listAuditLogs(startupId, {
        page: 1,
        limit: 100,
        search: searchQuery.trim() || undefined,
        entityType: entityType || undefined,
      }),
  });

  const rows = logsQuery.data?.data ?? [];
  const entityTypes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.entityType))).sort(),
    [rows],
  );

  const onExport = async () => {
    setExporting(true);
    try {
      const csv = await exportAuditLogsCsv(startupId, {
        search: searchQuery.trim() || undefined,
        entityType: entityType || undefined,
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${startupId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Audit log exported");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not export audit log"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Immutable log of every action across your startup workspace."
        actions={
          <Button variant="outline" size="sm" disabled={exporting} onClick={() => void onExport()}>
            <Download className="mr-1.5 h-4 w-4" /> {exporting ? "Exporting…" : "Export"}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search actions, users, entities…"
            className="h-9 border-border bg-surface pl-9"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
          value={entityType ?? ""}
          onChange={(event) => setEntityType(event.target.value || null)}
        >
          <option value="">All entity types</option>
          {entityTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div className="card-elevated overflow-hidden">
        {logsQuery.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : logsQuery.isError ? (
          <EmptyState
            icon={ScrollText}
            title="Could not load audit log"
            description={apiErrorMessage(logsQuery.error, "Please try again.")}
            action={<Button onClick={() => void logsQuery.refetch()}>Retry</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit events yet"
            description="Actions across this workspace will appear here as they happen."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Detail</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[13px]">
                {rows.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-hover/50">
                    <td className="px-4 py-3 text-muted-foreground">{formatWhen(log.createdAt)}</td>
                    <td className="px-4 py-3">{log.user.name}</td>
                    <td className="px-4 py-3">
                      <Badge className="border-0 bg-primary/10 capitalize text-primary">{log.action}</Badge>
                    </td>
                    <td className="px-4 py-3">{log.entityType}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground" title={log.detail}>
                      {log.detail}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{log.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
