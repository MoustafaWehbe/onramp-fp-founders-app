import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "../../../components/ui/button";
import { apiErrorMessage } from "../../../lib/api-error";
import { useAppStore, type FundingChartRange } from "../../../lib/app-store";
import { getFundingHistory, isBankable, type FundingHistoryEvent } from "../../../lib/fundraising-api";
import { qk } from "../../../lib/query-keys";
import { cn, formatCompactMoney, formatMoney } from "../../../lib/utils";

const RANGE_OPTIONS: { value: FundingChartRange; label: string }[] = [
  { value: 3, label: "3M" },
  { value: 6, label: "6M" },
  { value: 12, label: "12M" },
  { value: "all", label: "All" },
];

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/**
 * Cumulative bankable total at the end of each month, replayed from real
 * status transitions rather than derived from when each commitment row was
 * created a commitment recorded as soft-circled in January and wired in
 * March raised its money in March, not January. A commitment that moves
 * backward (withdrawn after being wired) shows the total actually dropping,
 * because that is what really happened.
 */
function buildMonthlySeries(events: FundingHistoryEvent[], range: FundingChartRange) {
  const sorted = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let running = 0;
  const timeline = sorted.map((event) => {
    if (event.fromStatus && isBankable(event.fromStatus)) running -= event.amount ?? 0;
    if (isBankable(event.toStatus)) running += event.amount ?? 0;
    return { time: new Date(event.createdAt).getTime(), total: running };
  });

  const now = new Date();
  const monthsBack =
    range === "all"
      ? Math.max(1, monthsBetween(new Date(sorted[0].createdAt), now) + 1)
      : range;

  return Array.from({ length: monthsBack }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1 - index), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime();

    let total = 0;
    for (const point of timeline) {
      if (point.time > endOfMonth) break;
      total = point.total;
    }

    return {
      month: date.toLocaleDateString("en-US", {
        month: "short",
        ...(monthsBack > 12 ? { year: "2-digit" as const } : {}),
      }),
      value: Math.max(0, Math.round(total)),
    };
  });
}

type FundingHistoryChartProps = {
  startupId: string;
  roundId: string | undefined;
  currency: string;
  /** Trims chrome for the Dashboard's tighter card; the Fundraising page gets the full header. */
  compact?: boolean;
};

/**
 * The funding-over-time chart, driven entirely by CommitmentStatusEvent rows
 * every point here can be traced to a real transition the API recorded,
 * never implied from a commitment's createdAt.
 */
export function FundingHistoryChart({ startupId, roundId, currency, compact = false }: FundingHistoryChartProps) {
  const range = useAppStore((state) => state.fundingChartRanges[startupId] ?? 6);
  const setRange = useAppStore((state) => state.setFundingChartRange);

  const historyQuery = useQuery({
    queryKey: qk.fundingHistory(startupId, roundId),
    queryFn: () => getFundingHistory(startupId, roundId!),
    enabled: Boolean(roundId),
  });

  const events = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);
  const series = useMemo(() => buildMonthlySeries(events, range), [events, range]);
  const current = series.at(-1)?.value ?? 0;

  return (
    <div className={cn(!compact && "card-elevated p-4 sm:p-5")}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold tracking-tight">Funding progress</h2>
            {historyQuery.isFetching && !historyQuery.isPending && (
              <span className="text-[11px] text-muted-foreground">Updating…</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Signed or wired, from when each commitment actually reached that status
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!historyQuery.isPending && !historyQuery.isError && events.length > 0 && (
            <span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
              {formatCompactMoney(current, currency)}
            </span>
          )}
          <div
            role="group"
            aria-label="Chart time range"
            className="inline-flex items-center gap-0.5 rounded-lg border border-border/70 bg-surface/60 p-0.5"
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={range === option.value}
                onClick={() => setRange(startupId, option.value)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  range === option.value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {historyQuery.isPending && (
        <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">
          Loading funding history…
        </div>
      )}

      {historyQuery.isError && (
        <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.05] text-center text-sm text-destructive">
          <AlertTriangle className="h-5 w-5" />
          {apiErrorMessage(historyQuery.error, "Could not load funding history.")}
          <Button size="sm" variant="outline" onClick={() => void historyQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!historyQuery.isPending && !historyQuery.isError && events.length === 0 && (
        <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-center">
          <TrendingUp className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">No commitments recorded yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Once a commitment is logged, this chart fills in as it moves toward wired.
          </p>
        </div>
      )}

      {!historyQuery.isPending && !historyQuery.isError && events.length > 0 && (
        <div className="h-[220px]" aria-label="Funding progress chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="funding-history-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F97316" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
              <XAxis dataKey="month" stroke="#8B949E" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                width={52}
                stroke="#8B949E"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatCompactMoney(Number(value), currency)}
              />
              <Tooltip
                formatter={(value) => [formatMoney(Number(value), currency), "Raised"]}
                contentStyle={{ background: "#1C2128", border: "1px solid #30363D", borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: "#8B949E" }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#F97316"
                strokeWidth={2.5}
                fill="url(#funding-history-gradient)"
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
