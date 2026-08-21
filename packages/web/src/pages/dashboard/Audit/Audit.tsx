import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../../../components/shared/EmptyState";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { apiErrorMessage } from "../../../lib/api-error";
import { exportAuditLogsCsv, getAuditLogFacets, listAuditLogs } from "../../../lib/audit-api";
import { AuditTimeline } from "./AuditTimeline";
import { AuditToolbar } from "./AuditToolbar";
import { EMPTY_AUDIT_FILTERS, type AuditFilters } from "./audit-filters";

const PAGE_SIZE = 30;

export function Audit() {
  const startupId = useActiveStartupId();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [exporting, setExporting] = useState(false);

  const queryFilters = {
    search: search.trim() || undefined,
    entityType: filters.entityTypes,
    action: filters.actions,
    from: filters.from?.toISOString(),
    to: filters.to?.toISOString(),
  };

  const logsQuery = useQuery({
    queryKey: ["audit-logs", startupId, queryFilters, visibleLimit],
    queryFn: () => listAuditLogs(startupId, { page: 1, limit: visibleLimit, ...queryFilters }),
    placeholderData: (previous) => previous,
  });

  const facetsQuery = useQuery({
    queryKey: ["audit-logs", startupId, "facets"],
    queryFn: () => getAuditLogFacets(startupId),
  });

  const rows = logsQuery.data?.data ?? [];
  const total = logsQuery.data?.meta.total ?? 0;

  function updateFilters(next: AuditFilters) {
    setFilters(next);
    setVisibleLimit(PAGE_SIZE);
  }

  function updateSearch(value: string) {
    setSearch(value);
    setVisibleLimit(PAGE_SIZE);
  }

  const onExport = async () => {
    setExporting(true);
    try {
      const csv = await exportAuditLogsCsv(startupId, queryFilters);
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

      <AuditToolbar
        search={search}
        onSearchChange={updateSearch}
        filters={filters}
        onFiltersChange={updateFilters}
        facets={facetsQuery.data}
      />

      {logsQuery.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : logsQuery.isError ? (
        <div className="card-elevated">
          <EmptyState
            icon={ScrollText}
            title="Could not load audit log"
            description={apiErrorMessage(logsQuery.error, "Please try again.")}
            action={<Button onClick={() => void logsQuery.refetch()}>Retry</Button>}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="card-elevated">
          <EmptyState
            icon={ScrollText}
            title="No audit events yet"
            description="Actions across this workspace will appear here as they happen."
          />
        </div>
      ) : (
        <>
          <AuditTimeline entries={rows} />
          {rows.length < total && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={logsQuery.isFetching}
                onClick={() => setVisibleLimit((current) => current + PAGE_SIZE)}
              >
                {logsQuery.isFetching ? "Loading…" : `Load more (${total - rows.length} remaining)`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
