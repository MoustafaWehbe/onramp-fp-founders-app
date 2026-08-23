import { AlertTriangle, CheckCircle2, Layers, TrendingUp, type LucideIcon } from "lucide-react";
import { cn, formatCompactMoney } from "../../../lib/utils";

export type PipelineTotals = {
  /** Every deal that has not been passed on. */
  liveCount: number;
  liveValue: number;
  weightedValue: number;
  committedCount: number;
  committedValue: number;
  attentionCount: number;
};

type Tile = {
  key: string;
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
};

type PipelineSummaryProps = {
  totals: PipelineTotals;
  /** The round's own currency a deal's amount is never assumed to be USD. */
  currency: string;
  /** Set when the "needs attention" filter is on, so the tile reads as pressed. */
  attentionActive: boolean;
  onToggleAttention: () => void;
};

export function PipelineSummary({
  totals,
  currency,
  attentionActive,
  onToggleAttention,
}: PipelineSummaryProps) {
  const tiles: Tile[] = [
    {
      key: "live",
      label: "Live pipeline",
      value: formatCompactMoney(totals.liveValue, currency),
      hint: `${totals.liveCount} open deal${totals.liveCount === 1 ? "" : "s"}`,
      icon: Layers,
      tone: "bg-primary/15 text-primary",
    },
    {
      key: "weighted",
      label: "Weighted forecast",
      value: formatCompactMoney(totals.weightedValue, currency),
      hint: "Expected amount × probability",
      icon: TrendingUp,
      tone: "bg-info/15 text-info",
    },
    {
      key: "committed",
      label: "Committed",
      value: formatCompactMoney(totals.committedValue, currency),
      hint: `${totals.committedCount} investor${totals.committedCount === 1 ? "" : "s"}`,
      icon: CheckCircle2,
      tone: "bg-success/15 text-success",
    },
  ];

  return (
    <section
      aria-label="Pipeline summary"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {tiles.map(({ key, ...tile }) => (
        <div key={key} className="rounded-xl border border-border/70 bg-surface/50 p-4">
          <TileBody {...tile} />
        </div>
      ))}

      {/* The one tile that is a control: it filters the board to what's slipping. */}
      <button
        type="button"
        onClick={onToggleAttention}
        aria-pressed={attentionActive}
        className={cn(
          "rounded-xl border p-4 text-left transition-colors",
          totals.attentionCount > 0
            ? "border-warning/40 bg-warning/6 hover:border-warning/70"
            : "border-border/70 bg-surface/50 hover:border-border",
          attentionActive && "border-warning ring-1 ring-warning/40",
        )}
      >
        <TileBody
          label="Needs attention"
          value={String(totals.attentionCount)}
          hint={
            attentionActive
              ? "Showing these only click to clear"
              : "Overdue follow-ups and quiet deals"
          }
          icon={AlertTriangle}
          tone={
            totals.attentionCount > 0
              ? "bg-warning/15 text-warning"
              : "bg-muted text-muted-foreground"
          }
        />
      </button>
    </section>
  );
}

function TileBody({ label, value, hint, icon: Icon, tone }: Omit<Tile, "key">) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", tone)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>
    </>
  );
}
