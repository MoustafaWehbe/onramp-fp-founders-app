import { useState } from "react";
import { ArrowDownRight, Clock, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getStage } from "../../../lib/pipeline-stages";
import type { PipelineAnalytics } from "../../../lib/pipeline-api";
import { cn, formatCompactMoney } from "../../../lib/utils";
import { formatDuration } from "./deal-signals";

type FunnelRow = PipelineAnalytics["funnel"][number];
type ConversionRow = PipelineAnalytics["conversion"][number];

type PipelineFunnelProps = {
  funnel: FunnelRow[];
  conversion: ConversionRow[];
  /** The round's own currency a deal's amount is never assumed to be USD. */
  currency: string;
};

/**
 * "Passed" is an exit, not a step forward mixing it into the taper would
 * break the funnel's shape and its story. It's already covered by the win
 * rate on the outcomes tiles above.
 */
const STAGE_ACCENT: Record<string, string> = {
  sourced: "var(--muted-foreground)",
  contacted: "var(--info)",
  meeting_scheduled: "var(--warning)",
  due_diligence: "var(--chart-5)",
  term_sheet: "var(--chart-6)",
  committed: "var(--success)",
};

const ROW_HEIGHT = 60;
const MIN_WIDTH = 32;

function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function PipelineFunnel({ funnel, conversion, currency }: PipelineFunnelProps) {
  const navigate = useNavigate();
  const rows = funnel.filter((row) => row.stage !== "passed");
  const [hovered, setHovered] = useState<string | null>(rows[0]?.stage ?? null);

  const widest = Math.max(...rows.map((row) => row.everReached), 1);
  const widthOf = (reached: number) => Math.max((reached / widest) * 100, MIN_WIDTH);

  const conversionInto = new Map(conversion.map((row) => [row.toStage, row]));
  const detail = rows.find((row) => row.stage === hovered) ?? rows[0] ?? null;
  const detailConversion = detail ? conversionInto.get(detail.stage) : undefined;
  const detailStage = detail ? getStage(detail.stage) : null;

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <div className="min-w-0 flex-1">
        <ol className="mx-auto flex w-full max-w-md flex-col">
          {rows.map((row, index) => {
            const stage = getStage(row.stage);
            const topWidth = widthOf(row.everReached);
            const nextReached = rows[index + 1]?.everReached ?? row.everReached * 0.78;
            const bottomWidth =
              index === rows.length - 1 ? topWidth * 0.7 : widthOf(nextReached);
            const accent = STAGE_ACCENT[row.stage] ?? "var(--primary)";
            const isHovered = hovered === row.stage;
            const nextConversion = conversionInto.get(rows[index + 1]?.stage ?? "");

            return (
              <li
                key={row.stage}
                className="relative animate-in fade-in-0 fill-mode-backwards duration-500"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <button
                  type="button"
                  onMouseEnter={() => setHovered(row.stage)}
                  onFocus={() => setHovered(row.stage)}
                  onClick={() => navigate(`/investors?tab=engaged&stage=${row.stage}`)}
                  className="group relative block w-full cursor-pointer focus-visible:outline-hidden"
                  style={{ height: ROW_HEIGHT }}
                  aria-label={`${stage.label}: ${row.everReached} deals ever reached this stage. Open the investor list filtered to this stage.`}
                >
                  <div
                    className={cn(
                      "absolute inset-0 mx-auto transition-[filter] duration-200",
                      isHovered ? "brightness-110" : "brightness-100",
                    )}
                    style={{
                      clipPath: `polygon(${50 - topWidth / 2}% 0%, ${50 + topWidth / 2}% 0%, ${50 + bottomWidth / 2}% 100%, ${50 - bottomWidth / 2}% 100%)`,
                    }}
                  >
                    <div
                      className="h-full w-full"
                      style={{
                        background: `linear-gradient(155deg, hsl(${accent} / 0.95), hsl(${accent} / 0.6))`,
                        boxShadow: isHovered
                          ? `0 0 0 1px hsl(${accent} / 0.7), 0 12px 28px -10px hsl(${accent} / 0.65)`
                          : `inset 0 1px 0 hsl(0 0% 100% / 0.12)`,
                      }}
                    />
                  </div>

                  <div className="pointer-events-none relative flex h-full flex-col items-center justify-center gap-0.5 px-4">
                    <span className="text-[11px] font-medium text-background/90 drop-shadow-xs">
                      {stage.label}
                    </span>
                    <span className="font-display text-lg font-bold leading-none text-background drop-shadow-xs tabular-nums">
                      {row.everReached}
                    </span>
                  </div>
                </button>

                {index < rows.length - 1 && (
                  <div className="relative z-10 -my-2 flex justify-center">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums shadow-xs transition-colors",
                        hovered === row.stage || hovered === rows[index + 1]?.stage
                          ? "border-primary/50 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <ArrowDownRight className="h-3 w-3" />
                      {percent(nextConversion?.rate ?? null)}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {detail && detailStage && (
        <div className="w-full shrink-0 rounded-2xl border border-border/70 bg-surface/60 p-4 sm:w-52">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", detailStage.dotClass)} />
            <span className="truncate font-display text-sm font-semibold text-foreground">
              {detailStage.label}
            </span>
          </div>

          <dl className="mt-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                Ever reached
              </dt>
              <dd className="font-mono font-semibold tabular-nums text-foreground">
                {detail.everReached}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Sitting here now</dt>
              <dd className="font-mono font-semibold tabular-nums text-foreground">
                {detail.current}
                {detail.currentValue > 0 && (
                  <span className="ml-1 text-muted-foreground">
                    ({formatCompactMoney(detail.currentValue, currency)})
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Median time here
              </dt>
              <dd className="font-mono font-semibold tabular-nums text-foreground">
                {detail.medianDaysInStage === null
                  ? "—"
                  : formatDuration(Math.round(detail.medianDaysInStage))}
              </dd>
            </div>
            {detailConversion && (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                <dt className="text-muted-foreground">Reached from prior stage</dt>
                <dd className="font-mono font-semibold tabular-nums text-foreground">
                  {percent(detailConversion.rate)}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
