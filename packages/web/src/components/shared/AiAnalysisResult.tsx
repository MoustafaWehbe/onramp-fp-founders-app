import { Check } from "lucide-react";
import { cn } from "../../lib/utils";
import type { AiAnalysis } from "../../lib/ai-api";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-warning/15 text-warning",
  medium: "bg-info/15 text-info",
  low: "bg-muted text-muted-foreground",
};
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Score grid, strengths, and a prioritized-gaps table for a completed deck
 * analysis. Shared between the AI Copilot's inline analysis card and the
 * Documents page's persistent analytics view, so both surfaces render the
 * same underlying AiAnalysis.result the same way. Investor personas are
 * deliberately excluded here — the two callers need different actions
 * attached to them (rehearsal in chat needs the relational persona id,
 * which result.personas doesn't carry), so each renders its own.
 */
export function AiAnalysisResult({ analysis }: { analysis: AiAnalysis }) {
  const result = analysis.result;
  const scores = [
    ["Overall", analysis.overallScore],
    ["Narrative", analysis.narrativeScore],
    ["Market", analysis.marketValidationScore],
    ["Financial", analysis.financialScore],
    ["Confidence", analysis.confidenceScore],
  ] as const;
  const sortedGaps = [...(result?.gaps ?? [])].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const summary = analysis.summaryReport ?? result?.executiveSummary ?? null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-5 gap-1.5">
        {scores.map(([label, score]) => (
          <div key={label} className={cn("rounded-lg border p-2 text-center", label === "Overall" ? "border-primary/30 bg-primary/5" : "border-border/60 bg-surface/40")}>
            <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("mt-0.5 font-display text-lg font-semibold", label === "Overall" && "text-primary")}>{score ?? "—"}</div>
          </div>
        ))}
      </div>

      {summary && <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>}

      {result?.strengths?.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Strengths</h3>
          <ul className="space-y-2">
            {result.strengths.map((strength, index) => (
              <li key={index} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                <span className="text-foreground/90">{strength.statement}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sortedGaps.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Prioritized gaps</h3>
          <div className="scrollbar-slim overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-surface/60">
                <tr>
                  <th className="border-b border-border/60 px-2.5 py-1.5 font-medium text-muted-foreground">Section</th>
                  <th className="border-b border-border/60 px-2.5 py-1.5 font-medium text-muted-foreground">Severity</th>
                  <th className="border-b border-border/60 px-2.5 py-1.5 font-medium text-muted-foreground">Issue</th>
                  <th className="border-b border-border/60 px-2.5 py-1.5 font-medium text-muted-foreground">Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {sortedGaps.map((gap, index) => (
                  <tr key={index}>
                    <td className="border-b border-border/40 px-2.5 py-1.5 align-top font-medium capitalize text-foreground/90">{gap.section.replace(/_/g, " ")}</td>
                    <td className="border-b border-border/40 px-2.5 py-1.5 align-top">
                      <span className={cn("whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs font-medium capitalize", SEVERITY_STYLE[gap.severity] ?? SEVERITY_STYLE.low)}>{gap.severity}</span>
                    </td>
                    <td className="border-b border-border/40 px-2.5 py-1.5 align-top text-foreground/80">{gap.issue}</td>
                    <td className="border-b border-border/40 px-2.5 py-1.5 align-top text-foreground/80">{gap.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
