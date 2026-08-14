import { ArrowRight, Clock, Info, PieChart } from "lucide-react";
import { EmptyState } from "../../../components/shared/EmptyState";
import { getStage } from "../../../lib/mock-data";
import type { PipelineAnalytics } from "../../../lib/pipeline-api";
import { cn } from "../../../lib/utils";
import { formatDuration } from "./deal-signals";
import { PipelineFunnel } from "./PipelineFunnel";

type PipelineAnalyticsViewProps = {
  analytics: PipelineAnalytics;
  /** The round's own currency — a deal's amount is never assumed to be USD. */
  currency: string;
};

function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function PipelineAnalyticsView({ analytics, currency }: PipelineAnalyticsViewProps) {
  const { funnel, conversion, outcomes, totalDeals } = analytics;

  if (totalDeals === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70">
        <EmptyState
          icon={PieChart}
          title="No deals to analyse yet"
          description="Add investors to the board and these numbers fill in as deals move."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-label="Outcomes" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Deals tracked" value={String(totalDeals)} hint="Everything on the board" />
        <Stat label="Still open" value={String(outcomes.open)} hint="Not committed or passed" />
        <Stat
          label="Committed"
          value={String(outcomes.committed)}
          hint={`${outcomes.passed} passed`}
          tone="text-success"
        />
        <Stat
          label="Win rate"
          value={percent(outcomes.winRate)}
          hint={
            outcomes.winRate === null
              ? "Nothing decided yet"
              : "Of deals that reached a decision"
          }
        />
      </section>

      <section aria-label="Funnel" className="space-y-3 rounded-2xl border border-border/70 bg-surface/40 p-4 sm:p-6">
        <div>
          <h2 className="font-display text-sm font-semibold">Funnel</h2>
          <p className="text-xs text-muted-foreground">
            How many deals have ever reached each stage, from stage history — a deal that later
            passed still counts for every stage it got to. Hover a stage for the detail.
          </p>
        </div>

        <PipelineFunnel funnel={funnel} conversion={conversion} currency={currency} />
      </section>

      <section aria-label="Conversion" className="space-y-3">
        <div>
          <h2 className="font-display text-sm font-semibold">Stage conversion</h2>
          <p className="text-xs text-muted-foreground">
            Of the deals that reached a stage, how many went further. This is the number that
            tells you how many intros you still need.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {conversion.map((row) => (
            <div
              key={row.fromStage}
              className="rounded-2xl border border-border/70 bg-surface/50 p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="truncate">{getStage(row.fromStage).label}</span>
                <ArrowRight className="h-3 w-3 shrink-0" />
                <span className="truncate">{getStage(row.toStage).label}</span>
              </div>
              <div className="mt-1 font-display text-xl font-semibold tabular-nums">
                {percent(row.rate)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                {row.advanced} of {row.reached}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Velocity" className="space-y-3">
        <div>
          <h2 className="font-display text-sm font-semibold">Time in stage</h2>
          <p className="text-xs text-muted-foreground">
            Median length of finished visits. Deals sitting in a stage right now are excluded —
            those visits haven't ended, and counting them would flatter every number.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {funnel
            .filter((row) => row.stage !== "passed")
            .map((row) => (
              <div
                key={row.stage}
                className="flex items-center gap-2 rounded-xl border border-border/70 bg-surface/50 p-3"
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", getStage(row.stage).dotClass)} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {getStage(row.stage).label}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {row.medianDaysInStage === null
                    ? "—"
                    : formatDuration(Math.round(row.medianDaysInStage))}
                </span>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface/50 p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", tone)}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
