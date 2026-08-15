import { Crown, FileText, ListChecks, Wallet } from "lucide-react";
import { Badge } from "../ui/badge";
import { getStage } from "../../lib/mock-data";
import { formatCompactMoney, formatDate, cn } from "../../lib/utils";
import { ROUND_STATUS_LABELS, type RoundStatus } from "../../lib/fundraising-api";
import { INVESTOR_TYPE_LABELS, type InvestorType } from "../../lib/investor-api";
import { PRIORITY_LABELS } from "../../lib/task-api";
import type { ResolvedMention } from "../../lib/chat-api";

/**
 * Only the CRM-anchored reference types unfurl into a card — a chip that
 * just names a teammate ("hey @Alice") does not need a card underneath it
 * the way a deal or a document does.
 */
const UNFURLABLE = new Set<ResolvedMention["type"]>(["investor", "deal", "task", "round", "document"]);

export function isUnfurlable(type: ResolvedMention["type"]): boolean {
  return UNFURLABLE.has(type);
}

export function EntityUnfurl({ mention }: { mention: ResolvedMention }) {
  switch (mention.type) {
    case "investor":
      return (
        <UnfurlCard title={mention.title} subtitle={mention.subtitle}>
          {mention.investorType && (
            <Badge variant="outline" className="border-border/70 bg-surface font-medium">
              {INVESTOR_TYPE_LABELS[mention.investorType as InvestorType] ?? mention.investorType}
            </Badge>
          )}
        </UnfurlCard>
      );

    case "deal": {
      const stage = getStage(mention.stage);
      return (
        <UnfurlCard title={mention.title} subtitle={mention.subtitle}>
          <Badge variant="outline" className={cn("border-transparent font-medium", stage.badgeClass)}>
            {stage.label}
          </Badge>
          {mention.isLead && (
            <Badge variant="outline" className="gap-1 border-warning/35 bg-warning/[0.1] font-medium text-warning">
              <Crown className="h-3 w-3" /> Lead
            </Badge>
          )}
          {mention.expectedAmount !== null && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatCompactMoney(mention.expectedAmount, mention.currency)}
            </span>
          )}
          {mention.ownerName && (
            <span className="text-xs text-muted-foreground">Owner: {mention.ownerName}</span>
          )}
        </UnfurlCard>
      );
    }

    case "task":
      return (
        <UnfurlCard title={mention.title} icon={ListChecks}>
          <Badge
            variant="outline"
            className={cn(
              "border-transparent font-medium",
              mention.status === "completed"
                ? "bg-success/15 text-success"
                : "bg-surface text-muted-foreground",
            )}
          >
            {mention.status === "completed" ? "Completed" : "Open"}
          </Badge>
          <Badge variant="outline" className="border-border/70 bg-surface font-medium">
            {PRIORITY_LABELS[mention.priority]} priority
          </Badge>
          {mention.dueDate && (
            <span className="text-xs text-muted-foreground">Due {formatDate(mention.dueDate)}</span>
          )}
        </UnfurlCard>
      );

    case "round":
      return (
        <UnfurlCard title={mention.title} icon={Wallet}>
          <Badge variant="outline" className="border-border/70 bg-surface font-medium">
            {ROUND_STATUS_LABELS[mention.status as RoundStatus] ?? mention.status}
          </Badge>
          {mention.targetAmount !== null && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              Target {formatCompactMoney(mention.targetAmount, mention.currency)}
            </span>
          )}
        </UnfurlCard>
      );

    case "document":
      return (
        <UnfurlCard title={mention.title} icon={FileText}>
          <Badge variant="outline" className="border-border/70 bg-surface font-medium capitalize">
            {mention.documentType.replace(/_/g, " ")}
          </Badge>
        </UnfurlCard>
      );

    case "member":
      return null;
  }
}

function UnfurlCard({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string | null;
  icon?: typeof Wallet;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-1.5 flex max-w-md flex-wrap items-center gap-2 rounded-lg border border-border/70 border-l-[3px] border-l-primary/60 bg-surface/40 px-3 py-2">
      <div className="min-w-0 basis-full sm:basis-auto">
        <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          {title}
        </div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
}
