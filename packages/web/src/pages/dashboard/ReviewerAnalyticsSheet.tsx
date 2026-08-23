import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Copy, Eye, FileText, FileWarning, Link2, Lock, MailCheck, MessageSquare, Printer, ShieldCheck, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
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
import {
  getReviewerInvitationAnalytics,
  listReviewerInvitationActivity,
  reviewerDocumentContextHref,
  reviewerStatusClass,
  type ReviewerActivityItem,
} from "../../lib/reviewer-api";
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
  forward_suspected: { label: "Forwarding signals", icon: AlertTriangle },
  download_completed: { label: "Downloads", icon: FileWarning },
};

const ACTIVITY_META: Record<ReviewerActivityItem["type"], { label: string; icon: typeof Clock }> = {
  invitation_created: { label: "Invitation created", icon: Link2 },
  invitation_sent: { label: "Invitation email sent", icon: MailCheck },
  access_verified: { label: "Reviewer verified access", icon: UserCheck },
  visit_started: { label: "Review session started", icon: Eye },
  page_viewed: { label: "Page viewed", icon: FileText },
  comment_added: { label: "Comment added", icon: MessageSquare },
  security_event: { label: "Security signal recorded", icon: AlertTriangle },
  review_completed: { label: "Review completed", icon: CheckCircle2 },
  invitation_revoked: { label: "Invitation revoked", icon: Lock },
};

function activityDescription(item: ReviewerActivityItem) {
  if (item.type === "visit_started") {
    const device = [item.details.deviceType, item.details.os, item.details.browser]
      .filter(Boolean)
      .join(" · ");
    return `${item.details.pagesViewed ?? 0} pages · ${formatDuration(Number(item.details.totalActiveMs ?? 0))}${device ? ` · ${device}` : ""}`;
  }
  if (item.type === "page_viewed") {
    return `${item.document?.title ?? "Document"}${item.pageNumber ? ` · page ${item.pageNumber}` : ""} · ${formatDuration(Number(item.details.activeMs ?? 0))}`;
  }
  if (item.type === "comment_added") return String(item.details.excerpt ?? "Reviewer feedback");
  if (item.type === "security_event") {
    return String(item.details.eventType ?? "Security event").replace(/_/g, " ");
  }
  return null;
}

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

  const activityQuery = useQuery({
    queryKey: ["reviewer-invitations", startupId, "activity", invitationId],
    queryFn: () => listReviewerInvitationActivity(startupId, invitationId as string, 50),
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
          <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {apiErrorMessage(query.error, "Could not load analytics.")}
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : !data ? null : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`${reviewerStatusClass(data.invitation.status)} border-0 capitalize`}>
                {data.invitation.status.replace("_", " ")}
              </Badge>
              <span className="text-xs text-muted-foreground">{data.invitation.email}</span>
              {data.invitation.requireNda && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <FileWarning className="h-3 w-3" /> NDA required
                </Badge>
              )}
              {data.invitation.hasPassword && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Lock className="h-3 w-3" /> Password set
                </Badge>
              )}
              {data.invitation.allowPrint && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Printer className="h-3 w-3" /> Print allowed
                </Badge>
              )}
            </div>

            {data.forwarding.suspected && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Opened from {data.forwarding.distinctDevices} device
                  {data.forwarding.distinctDevices === 1 ? "" : "s"}
                  {data.forwarding.distinctIps > 1 ? ` across ${data.forwarding.distinctIps} locations` : ""}.
                  This is a signal, not proof the link was forwarded — worth a look.
                </span>
              </div>
            )}

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
                        <span className="flex items-center gap-1.5">
                          {visit.suspectedForward && (
                            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                          )}
                          {formatDate(visit.startedAt)}
                          {(visit.deviceType || visit.os || visit.browser) && (
                            <span className="text-muted-foreground">
                              · {[visit.deviceType, visit.os, visit.browser].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </span>
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

            <div>
              <h3 className="mb-2 text-sm font-medium">Activity timeline</h3>
              {activityQuery.isPending ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : activityQuery.isError ? (
                <p className="text-xs text-destructive">
                  {apiErrorMessage(activityQuery.error, "Could not load activity timeline")}
                </p>
              ) : activityQuery.data?.length ? (
                <ol className="space-y-1.5">
                  {activityQuery.data.map((item) => {
                    const meta = ACTIVITY_META[item.type];
                    const Icon = meta.icon;
                    const description = activityDescription(item);
                    const contextHref = item.document
                      ? reviewerDocumentContextHref({
                          documentId: item.document.id,
                          versionId: item.document.versionId,
                          pageNumber: item.pageNumber,
                          sectionLabel:
                            typeof item.details.sectionLabel === "string"
                              ? item.details.sectionLabel
                              : null,
                        })
                      : null;
                    return (
                      <li
                        key={item.id}
                        className="flex items-start gap-2.5 rounded-md border border-border/70 p-2.5"
                      >
                        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="text-xs font-medium">{meta.label}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatDate(item.occurredAt)}
                            </span>
                          </div>
                          {description && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {description}
                            </p>
                          )}
                          {contextHref && (
                            <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0 text-xs">
                              <Link to={contextHref}>Open exact context</Link>
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">No reviewer activity recorded yet.</p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
