import { Plus, TrendingUp } from "lucide-react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Progress } from "../../../components/ui/progress";
import { getStage, investors, rounds } from "../../../lib/mock-data";
import { cn, formatCompactUsd } from "../../../lib/utils";

export function Fundraising() {
  const commitments = investors.filter((i) => i.pipelineStageId === "committed");
  const totalCommitted = commitments.reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fundraising rounds"
        description="Track targets, ticket sizes, and commitments across every round."
        actions={
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary-hover">
            <Plus className="mr-1.5 h-4 w-4" /> New round
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {rounds.map((r) => {
          const pct = r.target > 0 ? Math.round((r.raised / r.target) * 100) : 0;
          const active = r.status === "active";
          return (
            <div key={r.id} className="card-elevated p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Round
                  </div>
                  <div className="font-display text-lg font-semibold tracking-tight">{r.name}</div>
                </div>
                <Badge
                  className={cn(
                    "border-0 capitalize",
                    active
                      ? "bg-primary/15 text-primary"
                      : r.status === "closed"
                        ? "bg-success/15 text-success"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.status}
                </Badge>
              </div>
              <div className="mb-1 flex items-end justify-between">
                <div className="font-display text-2xl font-semibold tabular-nums">
                  {formatCompactUsd(r.raised)}
                </div>
                <div className="text-xs text-muted-foreground">of {formatCompactUsd(r.target)}</div>
              </div>
              <Progress value={pct} className="h-2" />
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-xs">
                <Stat label="Min ticket" value={formatCompactUsd(r.ticket)} />
                <Stat label="Equity" value={`${r.equity}%`} />
                <Stat label="Currency" value={r.currency} />
              </div>
            </div>
          );
        })}

        <div className="card-elevated p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Total committed</div>
              <div className="text-xs text-muted-foreground">Across all active rounds</div>
            </div>
          </div>
          <div className="font-display text-3xl font-semibold tabular-nums text-gradient-brand">
            {formatCompactUsd(totalCommitted)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {commitments.length} commitment{commitments.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="card-elevated overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="text-sm font-semibold">Commitments</div>
          <div className="text-xs text-muted-foreground">
            Investors who have signed or verbally committed.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Investor</th>
                <th className="px-4 py-3 font-medium">Firm</th>
                <th className="px-4 py-3 font-medium">Round</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Expected close</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {commitments.map((c) => {
                const stage = getStage(c.pipelineStageId);
                return (
                  <tr key={c.id} className="hover:bg-surface-hover/50">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.firm}</td>
                    <td className="px-4 py-3">Seed</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn("border-transparent font-medium", stage.badgeClass)}>
                        {stage.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatCompactUsd(c.amount)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">Q1 2026</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
