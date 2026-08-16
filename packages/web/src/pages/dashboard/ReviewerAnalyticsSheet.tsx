import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Copy, Eye, Printer, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { Skeleton } from "../../components/ui/skeleton";
import { PerPageTimeChart } from "../../components/shared/PerPageTimeChart";
import { StatTile } from "../../components/shared/StatTile";
import { apiErrorMessage } from "../../lib/api-error";
import { getReviewerInvitationAnalytics, reviewerStatusClass } from "../../lib/reviewer-api";
import { formatDate, formatDuration } from "../../lib/utils";

type ReviewerAnalyticsSheetProps = {
  startupId: string;
  invitationId: string | null;
  onOpenChange: (open: boolean) => void;
};

const SECURITY_META: Record<string, { label: string; icon: typeof Copy }> = {
  copy_attempt: { label: "Copy attempts", icon: Copy },
  print_attempt: { label: "Print attempts", icon: Printer },
  screenshot_attempt: { label: "Screenshot attempts", icon: Eye },
};

export function ReviewerAnalyticsSheet({
  startupId,
  invitationId,
  onOpenChange,
}: ReviewerAnalyticsSheetProps) {
  const open = invitationId !== null;

  const query = useQuery({
    queryKey: ["reviewer-invitations", startupId, "analytics", invitationId],
    queryFn: () => getReviewerInvitationAnalytics(startupId, invitationId as string),
    enabled: open,
  });

  const data = query.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Reviewer analytics</SheetTitle>
          <SheetDescription>
            {data ? data.invitation.reviewerName || data.invitation.email : "Engagement and security detail."}
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
        ) : !data ? null : (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Badge className={`${reviewerStatusClass(data.invitation.status)} border-0 capitalize`}>
                {data.invitation.status.replace("_", " ")}
              </Badge>
              <span className="text-xs text-muted-foreground">{data.invitation.email}</span>
            </div>

            {data.summary.visitCount === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 py-10 text-center">
                <Clock className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium">This reviewer hasn't opened the link yet</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Visit and page-level engagement will show up here once they verify their email and start reading.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile
                    label="Visits"
                    value={String(data.summary.visitCount)}
                    icon={Eye}
                    tone="muted"
                  />
                  <StatTile
                    label="Total time"
                    value={formatDuration(data.summary.totalActiveMs)}
                    icon={Clock}
                    tone="muted"
                  />
                  <StatTile
                    label="Last seen"
                    value={data.summary.lastSeenAt ? formatDate(data.summary.lastSeenAt) : "—"}
                    icon={Clock}
                    tone="muted"
                  />
                  <StatTile
                    label="Completion"
                    value={`${data.summary.completionPct}%`}
                    icon={ShieldCheck}
                    tone={data.summary.completionPct >= 80 ? "success" : "muted"}
                  />
                </div>

                {data.documents.map((doc) =>
                  doc.pages.length === 0 ? null : (
                    <div key={doc.versionId}>
                      <h3 className="mb-2 text-sm font-medium">
                        Time per page — {doc.title}
                      </h3>
                      <PerPageTimeChart pages={doc.pages} />
                    </div>
                  ),
                )}

                <div>
                  <h3 className="mb-2 text-sm font-medium">Visits</h3>
                  <ul className="space-y-1.5">
                    {data.visits.map((visit) => (
                      <li
                        key={visit.id}
                        className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-xs"
                      >
                        <span>{formatDate(visit.startedAt)}</span>
                        <span className="text-muted-foreground">
                          {formatDuration(visit.totalActiveMs)} · {visit.pagesViewed} pages ·{" "}
                          {visit.completionPct}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            <div>
              <h3 className="mb-2 text-sm font-medium">Capture attempts</h3>
              {Object.keys(data.security.counts).length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <ShieldCheck className="h-3.5 w-3.5" /> No copy, print, or screenshot attempts recorded.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.security.counts).map(([type, count]) => {
                    const meta = SECURITY_META[type];
                    const Icon = meta?.icon ?? ShieldCheck;
                    return (
                      <Badge key={type} variant="outline" className="gap-1.5">
                        <Icon className="h-3 w-3" /> {meta?.label ?? type}: {count}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
