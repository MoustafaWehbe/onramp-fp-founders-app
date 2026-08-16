import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Eye, ShieldCheck, TrendingDown, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "../../../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { Skeleton } from "../../../components/ui/skeleton";
import { PerPageTimeChart } from "../../../components/shared/PerPageTimeChart";
import { StatTile } from "../../../components/shared/StatTile";
import { apiErrorMessage } from "../../../lib/api-error";
import { getDocumentAnalytics } from "../../../lib/document-api";
import { formatDuration } from "../../../lib/utils";

type DocumentAnalyticsSheetProps = {
  startupId: string;
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
};

function DropOffChart({ dropOff }: { dropOff: Array<{ pageNumber: number; reachedPct: number }> }) {
  const data = dropOff.map((d) => ({ page: `P${d.pageNumber}`, pct: d.reachedPct }));

  return (
    <div className="h-[200px]" aria-label="Percent of viewers reaching each page">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="drop-off-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F97316" stopOpacity={0.42} />
              <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
          <XAxis dataKey="page" stroke="#8B949E" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis
            width={36}
            domain={[0, 100]}
            stroke="#8B949E"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip
            formatter={(value) => [`${value}%`, "Reached this page"]}
            contentStyle={{ background: "#1C2128", border: "1px solid #30363D", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "#8B949E" }}
          />
          <Area
            type="monotone"
            dataKey="pct"
            stroke="#F97316"
            strokeWidth={2.5}
            fill="url(#drop-off-gradient)"
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DocumentAnalyticsSheet({
  startupId,
  documentId,
  onOpenChange,
}: DocumentAnalyticsSheetProps) {
  const open = documentId !== null;

  const query = useQuery({
    queryKey: ["documents", startupId, "analytics", documentId],
    queryFn: () => getDocumentAnalytics(startupId, documentId as string),
    enabled: open,
  });

  const data = query.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Document analytics</SheetTitle>
          <SheetDescription>
            {data ? data.document.title : "Engagement across every reviewer who's seen this document."}
          </SheetDescription>
        </SheetHeader>

        {query.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.05] p-6 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {apiErrorMessage(query.error, "Could not load analytics.")}
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : !data ? null : data.summary.viewerCount === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 py-10 text-center">
            <Users className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No one has opened this document yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Once a reviewer opens the current version, viewer counts, drop-off, and per-page
              time will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Viewers" value={String(data.summary.viewerCount)} icon={Users} tone="muted" />
              <StatTile
                label="Total time"
                value={formatDuration(data.summary.totalActiveMs)}
                icon={Eye}
                tone="muted"
              />
              <StatTile
                label="Avg. completion"
                value={`${data.summary.avgCompletionPct}%`}
                icon={ShieldCheck}
                tone={data.summary.avgCompletionPct >= 80 ? "success" : "muted"}
              />
            </div>

            {data.dropOff.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <TrendingDown className="h-3.5 w-3.5" /> Drop-off by page
                </h3>
                <DropOffChart dropOff={data.dropOff} />
              </div>
            )}

            {data.pageAverages.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Average time per page</h3>
                <PerPageTimeChart
                  pages={data.pageAverages.map((p) => ({ pageNumber: p.pageNumber, activeMs: p.avgActiveMs }))}
                />
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-medium">Viewer leaderboard</h3>
              <ul className="space-y-1.5">
                {data.leaderboard.map((viewer, index) => (
                  <li
                    key={viewer.invitationId}
                    className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">#{index + 1}</span>
                      {viewer.reviewerName || viewer.email}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDuration(viewer.totalActiveMs)} · {viewer.completionPct}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
