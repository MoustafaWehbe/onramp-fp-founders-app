import { useNavigate } from "react-router-dom";
import { ChevronRight, Crown, FileText, ListChecks, Users, Briefcase, Wallet } from "lucide-react";
import { Badge } from "../ui/badge";
import { getStage } from "../../lib/mock-data";
import { formatCompactMoney, formatDate, cn } from "../../lib/utils";
import { ROUND_STATUS_LABELS, type RoundStatus } from "../../lib/fundraising-api";
import { INVESTOR_TYPE_LABELS, type InvestorType } from "../../lib/investor-api";
import { PRIORITY_LABELS } from "../../lib/task-api";
import { entityHref } from "../../lib/entity-routes";
import type { ResolvedMention } from "../../lib/chat-api";

export function EntityUnfurl({ mention }: { mention: ResolvedMention }) {
  const href = entityHref(mention);

  switch (mention.type) {
    case "investor":
      return (
        <UnfurlCard title={mention.title} subtitle={mention.subtitle} icon={Users} href={href}>
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
        <UnfurlCard title={mention.title} subtitle={mention.subtitle} icon={Briefcase} href={href}>
          <Badge variant="outline" className={cn("border-transparent font-medium", stage.badgeClass)}>
            {stage.label}
          </Badge>
          {mention.isLead && (
            <Badge variant="outline" className="gap-1 border-warning/35 bg-warning/10 font-medium text-warning">
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
        <UnfurlCard title={mention.title} icon={ListChecks} href={href}>
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
        <UnfurlCard title={mention.title} icon={Wallet} href={href}>
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
        <UnfurlCard title={mention.title} icon={FileText} href={href}>
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
  href,
  children,
}: {
  title: string;
  subtitle?: string | null;
  icon: typeof Wallet;
  href: string | null;
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();

  const content = (
    <>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <div className="truncate text-sm font-semibold text-foreground">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        {children && <div className="mt-1 flex flex-wrap items-center gap-1.5">{children}</div>}
      </div>
      {href && <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground/60" />}
    </>
  );

  const className =
    "mt-1.5 flex max-w-md items-start gap-3 rounded-lg border border-border/70 border-l-[3px] border-l-primary/60 bg-surface/40 px-3 py-2.5 text-left transition-colors";

  if (!href) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className={cn(className, "cursor-pointer hover:border-primary/40 hover:bg-surface/70")}
    >
      {content}
    </button>
  );
}
