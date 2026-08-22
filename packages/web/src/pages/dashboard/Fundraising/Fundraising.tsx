import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Sparkles, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { DatePicker } from "../../../components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Progress } from "../../../components/ui/progress";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { apiErrorMessage } from "../../../lib/api-error";
import { useAppStore } from "../../../lib/app-store";
import {
  COMMITMENT_STATUSES, COMMITMENT_STATUS_HINTS, COMMITMENT_STATUS_LABELS, ROUND_STATUSES, ROUND_STATUS_LABELS,
  createCommitment, createFundraisingRound, getRoundMetrics, listCommitments, listFundraisingRounds,
  updateCommitment, updateFundraisingRound, type AtRiskCommitment, type Commitment, type CommitmentInput,
  type CommitmentStatus, type FundraisingRound, type RoundInput, type RoundStatus,
} from "../../../lib/fundraising-api";
import { Select } from "../../../components/ui/select";
import { listPipelineEntries, type PipelineEntry } from "../../../lib/pipeline-api";
import { fetchAllPages } from "../../../lib/pagination";
import { invalidateFinancialData, qk } from "../../../lib/query-keys";
import { cn, formatDate, formatMoney } from "../../../lib/utils";
import { FundingHistoryChart } from "./FundingHistoryChart";

/** This page's amounts are frequently nullable (an unset target, an unset ticket size); formatMoney itself is not. */
function money(amount: number | null, currency: string) {
  return amount === null ? "—" : formatMoney(amount, currency);
}
function dateForPicker(value: string | null): Date | null { return value ? new Date(value) : null; }
function roundTone(status: RoundStatus) {
  return status === "active" ? "bg-primary/15 text-primary" : status === "closed" ? "bg-success/15 text-success" : status === "cancelled" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground";
}
function commitmentTone(status: CommitmentStatus) {
  return status === "wired" ? "bg-success/15 text-success" : status === "hard_circled" ? "bg-primary/15 text-primary" : status === "withdrawn" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground";
}

export function Fundraising() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const preferredRoundId = useAppStore((s) => s.activeRoundIds[startupId]);
  const setActiveRoundId = useAppStore((s) => s.setActiveRoundId);
  // A chat unfurl card or notification can deep-link straight to a round via
  // `?round=` read once on mount and fed into the same "active round"
  // selection state the round switcher already uses.
  const [deepLinkRoundId] = useState(() => new URLSearchParams(window.location.search).get("round"));
  useEffect(() => {
    if (deepLinkRoundId) setActiveRoundId(startupId, deepLinkRoundId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [roundDialog, setRoundDialog] = useState<FundraisingRound | "new" | null>(null);
  const [commitmentDialog, setCommitmentDialog] = useState<Commitment | "new" | null>(null);
  const roundsQuery = useQuery({ queryKey: qk.rounds(startupId), queryFn: () => listFundraisingRounds(startupId) });
  const rounds = useMemo(() => roundsQuery.data?.data ?? [], [roundsQuery.data]);
  const selectedRound = useMemo(() => rounds.find((round) => round.id === preferredRoundId) ?? rounds.find((round) => round.status === "active") ?? rounds[0] ?? null, [preferredRoundId, rounds]);
  useEffect(() => { if (selectedRound && selectedRound.id !== preferredRoundId) setActiveRoundId(startupId, selectedRound.id); }, [preferredRoundId, selectedRound, setActiveRoundId, startupId]);
  const commitmentsQuery = useQuery({ queryKey: qk.commitments(startupId, selectedRound?.id), queryFn: () => listCommitments(startupId, selectedRound?.id), enabled: Boolean(selectedRound) });
  // Clicking a status tile filters the table below in place no navigation
  // needed, the data is already on screen.
  const [statusFilter, setStatusFilter] = useState<CommitmentStatus | null>(null);
  useEffect(() => setStatusFilter(null), [selectedRound?.id]);
  // A separate request for the status a founder clicked kept apart from the
  // fetch above so filtering the table can never change what the total tiles
  // report; those always read every commitment in the round.
  const filteredCommitmentsQuery = useQuery({
    queryKey: qk.commitments(startupId, selectedRound?.id, statusFilter),
    queryFn: () => listCommitments(startupId, selectedRound?.id, statusFilter!),
    enabled: Boolean(selectedRound) && statusFilter !== null,
  });
  // Target, bankable, weighted pipeline, days to close, at-risk computed
  // once server-side rather than re-derived here, so this page can never
  // disagree with Dashboard about what "this round's numbers" are.
  const metricsQuery = useQuery({
    queryKey: qk.roundMetrics(startupId, selectedRound?.id),
    queryFn: () => getRoundMetrics(startupId, selectedRound!.id),
    enabled: Boolean(selectedRound),
  });
  // The same board entry Dashboard and Pipeline read, envelope and all this
  // used to hold a bare array under a near-identical key, so the two copies
  // could disagree about the round after a commitment moved a deal.
  const pipelineQuery = useQuery({
    queryKey: qk.pipeline(startupId, selectedRound?.id),
    queryFn: () => fetchAllPages((page, limit) => listPipelineEntries(startupId, { page, limit, roundId: selectedRound!.id })).then((data) => ({ data })),
    enabled: Boolean(selectedRound),
  });
  // Commitment writes move the linked deal's stage, so everything derived from
  // the board has to refetch too.
  const invalidateFinancial = () => invalidateFinancialData(queryClient, startupId);
  const createRoundMutation = useMutation({
    mutationFn: (input: RoundInput) => createFundraisingRound(startupId, input),
    onSuccess: (round) => { setActiveRoundId(startupId, round.id); setRoundDialog(null); toast.success("Fundraising round created"); invalidateFinancial(); },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not create round")),
  });
  const updateRoundMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<RoundInput> }) => updateFundraisingRound(startupId, id, input),
    onSuccess: () => { setRoundDialog(null); toast.success("Fundraising round updated"); invalidateFinancial(); },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not update round")),
  });
  const createCommitmentMutation = useMutation({
    mutationFn: (input: CommitmentInput) => createCommitment(startupId, input),
    onSuccess: () => { setCommitmentDialog(null); toast.success("Commitment added"); invalidateFinancial(); },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not add commitment")),
  });
  const updateCommitmentMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { amount: number; status: CommitmentStatus; expectedCloseDate?: string | null } }) => updateCommitment(startupId, id, input),
    onSuccess: () => { setCommitmentDialog(null); toast.success("Commitment updated"); invalidateFinancial(); },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not update commitment")),
  });
  const commitments = useMemo(() => commitmentsQuery.data?.data ?? [], [commitmentsQuery.data]);
  // The table shows the filtered request's rows once a status tile is
  // active; the API decides what matches, not a client-side re-scan.
  const visibleCommitments = statusFilter ? (filteredCommitmentsQuery.data?.data ?? []) : commitments;
  /**
   * Three numbers, not two. Soft-circled money is a verbal yes with nothing
   * signed it belongs on screen, because it is the pipeline of near-money a
   * founder works, but it must never be added to what has been raised. Only
   * hard-circled and wired count against the target.
   */
  const totals = useMemo(() => {
    const sum = (predicate: (item: Commitment) => boolean) =>
      commitments.filter(predicate).reduce((acc, item) => acc + (item.amount ?? 0), 0);

    const wired = sum((item) => item.status === "wired");
    // Signed but not yet in the bank, shown as its own slice so the gap
    // between "committed" and "collected" is never invisible.
    const hardCircled = sum((item) => item.status === "hard_circled");
    const softCircled = sum((item) => item.status === "soft_circled");
    const bankable = wired + hardCircled;
    const target = selectedRound?.targetAmount ?? 0;

    return {
      wired,
      hardCircled,
      softCircled,
      bankable,
      remaining: Math.max(0, target - bankable),
      percent: target ? Math.min(100, Math.round((bankable / target) * 100)) : 0,
      wiredPercent: target ? Math.min(100, (wired / target) * 100) : 0,
      hardPercent: target ? Math.min(100, (hardCircled / target) * 100) : 0,
      // Hard-circled money beyond the target is a decision, not an overflow.
      oversubscribed: target > 0 && bankable > target,
    };
  }, [commitments, selectedRound?.targetAmount]);
  const canCreate = can("financial", "create");
  const canUpdate = can("financial", "update");

  return <div className="space-y-7">
    <PageHeader title="Fundraising" description="A clear view of your raise, from first conversation to money in the bank." actions={canCreate ? <Button size="sm" onClick={() => setRoundDialog("new")}><Plus className="mr-1.5 h-4 w-4" /> New round</Button> : null} />
    {roundsQuery.isLoading && <LoadingCard label="Loading fundraising rounds…" />}
    {roundsQuery.isError && <ErrorCard message={apiErrorMessage(roundsQuery.error, "Could not load fundraising rounds.")} onRetry={() => void roundsQuery.refetch()} />}
    {!roundsQuery.isLoading && !roundsQuery.isError && rounds.length === 0 && <div className="card-elevated p-8 text-center"><h2 className="font-display text-lg font-semibold">Create your first raise</h2><p className="mt-1 text-sm text-muted-foreground">Set a target and currency, then add investors from the Pipeline.</p>{canCreate && <Button className="mt-4" onClick={() => setRoundDialog("new")}>Create a round</Button>}</div>}
    {rounds.length > 0 && <>
      <div className="grid gap-4 lg:grid-cols-3">{rounds.map((round) => {
        const isSelected = round.id === selectedRound?.id;
        const raised = isSelected ? totals.bankable : 0;
        const countdown = closeCountdown(round.firstCloseDate ?? round.targetCloseDate);
        return <button key={round.id} type="button" onClick={() => setActiveRoundId(startupId, round.id)} className={cn("card-elevated relative overflow-hidden p-5 text-left transition-colors hover:border-primary/40", isSelected && "border-primary/60 bg-primary/[0.035] ring-1 ring-primary/20")}><div className="mb-4 flex items-center justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Round</div><div className="font-display text-lg font-semibold tracking-tight">{round.roundName}</div></div><Badge className={cn("border-0 capitalize", roundTone(round.status))}>{round.status}</Badge></div><div className="mb-1 flex items-end justify-between gap-3"><div className="font-display text-2xl font-semibold tabular-nums">{isSelected ? money(raised, round.currency) : money(round.targetAmount, round.currency)}</div><div className="text-xs text-muted-foreground">{isSelected ? `of ${money(round.targetAmount, round.currency)}` : "target"}</div></div>{isSelected ? <SegmentedProgress wiredPercent={totals.wiredPercent} hardPercent={totals.hardPercent} /> : <Progress value={0} className="h-2" />}<div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-xs"><Stat label="Min ticket" value={money(round.minimumTicketSize, round.currency)} /><Stat label="Equity" value={round.equityOfferedPercentage === null ? "—" : `${round.equityOfferedPercentage}%`} /><Stat label={round.firstCloseDate ? "First close" : "Target close"} value={countdown ? countdown.text : "—"} /></div></button>;
      })}</div>
      {selectedRound && (
        <section className="space-y-5">
          <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-linear-to-br from-primary/10 via-card to-card p-6 sm:p-7">
            <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div>
                <Badge className={cn("border-0 capitalize", roundTone(selectedRound.status))}>{selectedRound.status}</Badge>
                <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{selectedRound.roundName}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{totals.percent}% secured toward {money(selectedRound.targetAmount, selectedRound.currency)}</p>
              </div>
              <div className="flex gap-2">
                {canUpdate && <Button size="sm" variant="outline" onClick={() => setRoundDialog(selectedRound)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
                {canCreate && <Button size="sm" onClick={() => setCommitmentDialog("new")} disabled={pipelineQuery.isLoading || (pipelineQuery.data?.data.length ?? 0) === 0}><Plus className="h-4 w-4" /> Add commitment</Button>}
              </div>
            </div>
            <div className="relative mt-7">
              <div className="mb-2 flex items-end justify-between gap-4">
                <span className="font-display text-2xl font-semibold tabular-nums">{money(totals.bankable, selectedRound.currency)}</span>
                <span className="text-sm text-muted-foreground">{money(totals.remaining, selectedRound.currency)} to go</span>
              </div>
              <SegmentedProgress wiredPercent={totals.wiredPercent} hardPercent={totals.hardPercent} />
              <div className="mt-2 flex gap-5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-success" /> Wired</span>
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary/60" /> Signed</span>
              </div>
            </div>
          </div>

          {/* Each tile doubles as a filter for the commitments table below —
              clicking "Wired" is a faster path to "show me the wired ones"
              than scanning the whole table for the badge. */}
          <section aria-label="Round totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric title="Wired" value={money(totals.wired, selectedRound.currency)} detail="In the bank" active={statusFilter === "wired"} onClick={() => setStatusFilter((s) => (s === "wired" ? null : "wired"))} />
            <Metric title="Hard-circled" value={money(totals.hardCircled, selectedRound.currency)} detail="Signed, not yet wired" active={statusFilter === "hard_circled"} onClick={() => setStatusFilter((s) => (s === "hard_circled" ? null : "hard_circled"))} />
            <Metric title="Soft-circled" value={money(totals.softCircled, selectedRound.currency)} detail="Verbal not counted" muted active={statusFilter === "soft_circled"} onClick={() => setStatusFilter((s) => (s === "soft_circled" ? null : "soft_circled"))} />
            <Metric title={totals.oversubscribed ? "Oversubscribed" : "Gap to target"} value={money(totals.oversubscribed ? totals.bankable - (selectedRound.targetAmount ?? 0) : totals.remaining, selectedRound.currency)} detail={`${totals.percent}% of ${money(selectedRound.targetAmount, selectedRound.currency)}`} />
          </section>

          <FundingHistoryChart startupId={startupId} roundId={selectedRound.id} currency={selectedRound.currency} />

          <RoundIntelligence
            metricsQuery={metricsQuery}
            currency={selectedRound.currency}
            onOpenCommitment={(commitmentId) => {
              const match = commitments.find((c) => c.id === commitmentId);
              if (match) setCommitmentDialog(match);
            }}
          />

          <div className="card-elevated overflow-hidden">
            <div className="flex items-center justify-between border-b border-border p-5">
              <div>
                <div className="font-display text-base font-semibold">Commitments</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {statusFilter
                    ? `Showing ${COMMITMENT_STATUS_LABELS[statusFilter].toLowerCase()} commitments only.`
                    : "Every verbal, signed, and funded commitment for this round."}
                </div>
              </div>
              {statusFilter ? (
                <div className="flex items-center gap-2">
                  {filteredCommitmentsQuery.isFetching && (
                    <span className="text-[11px] text-muted-foreground">Updating…</span>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setStatusFilter(null)}>
                    <X className="h-3.5 w-3.5" /> Clear filter
                  </Button>
                </div>
              ) : (
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary"><TrendingUp className="h-4 w-4" /></div>
              )}
            </div>
            {statusFilter && filteredCommitmentsQuery.isError && (
              <div className="border-b border-border px-5 py-4 text-sm text-destructive">
                <p>{apiErrorMessage(filteredCommitmentsQuery.error, "Could not load these commitments.")}</p>
                <Button className="mt-2" size="sm" variant="outline" onClick={() => void filteredCommitmentsQuery.refetch()}>
                  Retry
                </Button>
              </div>
            )}
            <CommitmentTable
              commitments={visibleCommitments}
              currency={selectedRound.currency}
              canUpdate={canUpdate}
              onEdit={setCommitmentDialog}
            />
          </div>
        </section>
      )}
    </>}
    <RoundDialog round={roundDialog} open={roundDialog !== null} busy={createRoundMutation.isPending || updateRoundMutation.isPending} onOpenChange={(open) => !open && setRoundDialog(null)} onSubmit={(input) => { if (roundDialog === "new") createRoundMutation.mutate(input); else if (roundDialog) updateRoundMutation.mutate({ id: roundDialog.id, input }); }} />
    <CommitmentDialog commitment={commitmentDialog} open={commitmentDialog !== null} pipeline={pipelineQuery.data?.data ?? []} round={selectedRound} busy={createCommitmentMutation.isPending || updateCommitmentMutation.isPending} onOpenChange={(open) => !open && setCommitmentDialog(null)} onCreate={createCommitmentMutation.mutate} onUpdate={(input) => commitmentDialog && commitmentDialog !== "new" && updateCommitmentMutation.mutate({ id: commitmentDialog.id, input })} />
  </div>;
}

function CommitmentTable({ commitments, currency, canUpdate, onEdit }: { commitments: Commitment[]; currency: string; canUpdate: boolean; onEdit: (commitment: Commitment) => void }) {
  if (!commitments.length) return <div className="p-8 text-center text-sm text-muted-foreground">No commitments yet. Add one from an investor already in this round’s pipeline.</div>;
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-surface/60 text-left text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Investor</th><th className="px-4 py-3 font-medium">Firm</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Amount</th><th className="px-4 py-3 font-medium">Expected close</th>{canUpdate && <th className="px-4 py-3" />}</tr></thead><tbody className="divide-y divide-border">{commitments.map((item) => <tr key={item.id} className="hover:bg-surface-hover/50"><td className="px-4 py-3 font-medium">{item.investor.fullName}</td><td className="px-4 py-3 text-muted-foreground">{item.investor.ventureFirm ?? "—"}</td><td className="px-4 py-3"><Badge variant="outline" className={cn("border-transparent", commitmentTone(item.status))}>{COMMITMENT_STATUS_LABELS[item.status]}</Badge></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(item.amount, currency)}</td><td className="px-4 py-3 text-muted-foreground">{item.expectedCloseDate ? formatDate(item.expectedCloseDate) : "—"}</td>{canUpdate && <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => onEdit(item)}>Edit</Button></td>}</tr>)}</tbody></table></div>;
}

function RoundDialog({ round, open, busy, onOpenChange, onSubmit }: { round: FundraisingRound | "new" | null; open: boolean; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (input: RoundInput) => void }) {
  const existing = round && round !== "new" ? round : null;
  const [form, setForm] = useState<{ roundName: string; targetAmount: string; minimumTicketSize: string; equityOfferedPercentage: string; currency: string; status: RoundStatus; firstCloseDate: Date | null; targetCloseDate: Date | null }>({ roundName: "", targetAmount: "", minimumTicketSize: "", equityOfferedPercentage: "", currency: "USD", status: "active", firstCloseDate: null, targetCloseDate: null });
  useEffect(() => { setForm(existing ? { roundName: existing.roundName, targetAmount: String(existing.targetAmount ?? ""), minimumTicketSize: existing.minimumTicketSize === null ? "" : String(existing.minimumTicketSize), equityOfferedPercentage: existing.equityOfferedPercentage === null ? "" : String(existing.equityOfferedPercentage), currency: existing.currency, status: existing.status, firstCloseDate: dateForPicker(existing.firstCloseDate), targetCloseDate: dateForPicker(existing.targetCloseDate) } : { roundName: "", targetAmount: "", minimumTicketSize: "", equityOfferedPercentage: "", currency: "USD", status: "active", firstCloseDate: null, targetCloseDate: null }); }, [existing, open]);
  function submit(event: FormEvent) { event.preventDefault(); const targetAmount = Number(form.targetAmount); if (!form.roundName.trim() || !Number.isFinite(targetAmount) || targetAmount < 0) return toast.error("Enter a round name and a valid target."); const minimumTicketSize = form.minimumTicketSize === "" ? undefined : Number(form.minimumTicketSize); const equityOfferedPercentage = form.equityOfferedPercentage === "" ? undefined : Number(form.equityOfferedPercentage); if ((minimumTicketSize !== undefined && (!Number.isFinite(minimumTicketSize) || minimumTicketSize < 0)) || (equityOfferedPercentage !== undefined && (!Number.isFinite(equityOfferedPercentage) || equityOfferedPercentage < 0 || equityOfferedPercentage > 100))) return toast.error("Enter valid optional ticket and equity values."); onSubmit({ roundName: form.roundName, targetAmount, ...(minimumTicketSize !== undefined ? { minimumTicketSize } : existing ? { minimumTicketSize: null } : {}), ...(equityOfferedPercentage !== undefined ? { equityOfferedPercentage } : existing ? { equityOfferedPercentage: null } : {}), currency: form.currency.toUpperCase(), status: form.status, ...(form.firstCloseDate ? { firstCloseDate: form.firstCloseDate.toISOString() } : existing ? { firstCloseDate: null } : {}), ...(form.targetCloseDate ? { targetCloseDate: form.targetCloseDate.toISOString() } : existing ? { targetCloseDate: null } : {}) }); }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl gap-0 overflow-hidden p-0 sm:p-0"><DialogHeader className="border-b border-border/70 bg-surface/40 px-6 py-5"><DialogTitle>{existing ? "Edit fundraising round" : "Create a fundraising round"}</DialogTitle><DialogDescription>Define the target first. Terms and close dates can be refined as the raise develops.</DialogDescription></DialogHeader><form className="space-y-5 px-6 py-5" onSubmit={submit}><section className="space-y-4"><div><h3 className="text-sm font-semibold">Raise essentials</h3><p className="text-xs text-muted-foreground">The name and amount your team will use across the pipeline.</p></div><Field label="Round name"><Input value={form.roundName} onChange={(e) => setForm({ ...form, roundName: e.target.value })} placeholder="Seed round" autoFocus /></Field><div className="grid gap-3 sm:grid-cols-[1fr_120px]"><Field label="Target amount"><Input type="number" min="0" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} placeholder="2000000" /></Field><Field label="Currency"><Input maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field></div></section><section className="space-y-4 border-t border-border/70 pt-5"><div><h3 className="text-sm font-semibold">Terms and timing</h3><p className="text-xs text-muted-foreground">Optional details that help the team qualify commitments.</p></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Minimum ticket"><Input type="number" min="0" value={form.minimumTicketSize} onChange={(e) => setForm({ ...form, minimumTicketSize: e.target.value })} placeholder="50000" /></Field><Field label="Equity offered (%)"><Input type="number" min="0" max="100" value={form.equityOfferedPercentage} onChange={(e) => setForm({ ...form, equityOfferedPercentage: e.target.value })} placeholder="15" /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="First close"><DatePicker value={form.firstCloseDate} onChange={(date) => setForm({ ...form, firstCloseDate: date })} /></Field><Field label="Target close"><DatePicker value={form.targetCloseDate} onChange={(date) => setForm({ ...form, targetCloseDate: date })} /></Field></div><Field label="Status"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as RoundStatus })} options={ROUND_STATUSES.map((status) => ({ value: status, label: ROUND_STATUS_LABELS[status] }))} /></Field></section><DialogFooter className="border-t border-border/70 pt-5"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Create round"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function CommitmentDialog({ commitment, open, pipeline, round, busy, onOpenChange, onCreate, onUpdate }: { commitment: Commitment | "new" | null; open: boolean; pipeline: PipelineEntry[]; round: FundraisingRound | null; busy: boolean; onOpenChange: (open: boolean) => void; onCreate: (input: CommitmentInput) => void; onUpdate: (input: { amount: number; status: CommitmentStatus; expectedCloseDate?: string | null }) => void }) {
  const existing = commitment && commitment !== "new" ? commitment : null;
  const [form, setForm] = useState<{ pipelineId: string; amount: string; status: CommitmentStatus; expectedCloseDate: Date | null }>({ pipelineId: "", amount: "", status: "soft_circled", expectedCloseDate: null });
  useEffect(() => { setForm(existing ? { pipelineId: existing.pipelineId, amount: String(existing.amount ?? ""), status: existing.status, expectedCloseDate: dateForPicker(existing.expectedCloseDate) } : { pipelineId: pipeline[0]?.id ?? "", amount: "", status: "soft_circled", expectedCloseDate: null }); }, [existing, open, pipeline]);
  function submit(event: FormEvent) { event.preventDefault(); const amount = Number(form.amount); const deal = pipeline.find((item) => item.id === form.pipelineId); if (!Number.isFinite(amount) || amount < 0) return toast.error("Enter a valid commitment amount."); const expectedCloseDate = form.expectedCloseDate ? form.expectedCloseDate.toISOString() : undefined; if (existing) return onUpdate({ amount, status: form.status, expectedCloseDate: expectedCloseDate ?? null }); if (!deal || !round) return toast.error("Choose an investor from this round’s pipeline."); onCreate({ investorId: deal.investorId, pipelineId: deal.id, roundId: round.id, amount, status: form.status, ...(expectedCloseDate && { expectedCloseDate }) }); }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl gap-0 overflow-hidden p-0 sm:p-0"><DialogHeader className="border-b border-border/70 bg-surface/40 px-6 py-5"><DialogTitle>{existing ? "Edit commitment" : "Record a commitment"}</DialogTitle><DialogDescription>{existing ? "Keep the amount, confidence, and close date current." : "Choose an investor already in this round, then capture what they committed."}</DialogDescription></DialogHeader><form className="space-y-5 px-6 py-5" onSubmit={submit}>{!existing && <Field label="Investor"><Select value={form.pipelineId} onValueChange={(value) => setForm({ ...form, pipelineId: value })} options={pipeline.map((deal) => ({ value: deal.id, label: `${deal.investor.fullName}${deal.investor.ventureFirm ? ` ${deal.investor.ventureFirm}` : ""}` }))} /></Field>}<div className="grid gap-4 rounded-xl border border-border/70 bg-surface/30 p-4 sm:grid-cols-2"><Field label="Commitment amount"><Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="250000" autoFocus={Boolean(existing)} /></Field><Field label="Expected close"><DatePicker value={form.expectedCloseDate} onChange={(date) => setForm({ ...form, expectedCloseDate: date })} /></Field></div><Field label="Confidence"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as CommitmentStatus })} options={COMMITMENT_STATUSES.map((status) => ({ value: status, label: `${COMMITMENT_STATUS_LABELS[status]} ${COMMITMENT_STATUS_HINTS[status]}` }))} /></Field><DialogFooter className="border-t border-border/70 pt-5"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Add commitment"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

/**
 * Wired money solid, hard-circled lighter behind it, against the target as the
 * track. A single bar cannot show the difference between money in the bank and
 * money merely promised, which is the distinction that matters most on a raise.
 */
function SegmentedProgress({ wiredPercent, hardPercent }: { wiredPercent: number; hardPercent: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <div className="h-full bg-success transition-[width]" style={{ width: `${wiredPercent}%` }} />
      <div className="h-full bg-primary/60 transition-[width]" style={{ width: `${hardPercent}%` }} />
    </div>
  );
}

/** "12 days overdue" / "in 5 days" / "today" for a commitment's expected close date. */
function overdueLabel(daysOverdue: number): string {
  if (daysOverdue === 0) return "due today";
  return `${daysOverdue}d overdue`;
}

type RoundIntelligenceProps = {
  metricsQuery: {
    data: { weightedPipeline: number; daysToClose: number | null; atRiskCommitments: AtRiskCommitment[] } | undefined;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  currency: string;
  onOpenCommitment: (commitmentId: string) => void;
};

/**
 * Weighted pipeline, days to close, and at-risk commitments the forward-
 * looking half of "how is this round actually going", as opposed to the
 * totals above which only describe money already recorded. Fails
 * independently of the rest of the page: a metrics-endpoint error here does
 * not take down the round totals or the commitments table, which come from
 * a different request.
 */
function RoundIntelligence({ metricsQuery, currency, onOpenCommitment }: RoundIntelligenceProps) {
  if (metricsQuery.isPending) {
    return <LoadingCard label="Crunching round metrics…" />;
  }

  if (metricsQuery.isError) {
    return (
      <ErrorCard
        message={apiErrorMessage(metricsQuery.error, "Could not load round metrics.")}
        onRetry={() => void metricsQuery.refetch()}
      />
    );
  }

  const metrics = metricsQuery.data;
  if (!metrics) return null;

  return (
    <section aria-label="Round intelligence" className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-sm font-semibold text-muted-foreground">Forecast</h3>
        {metricsQuery.isFetching && (
          <span className="text-[11px] text-muted-foreground">Updating…</span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Metric
          title="Weighted pipeline"
          value={money(metrics.weightedPipeline, currency)}
          detail="Live deals × probability, excluding what's already committed"
        />
        <Metric
          title="Days to close"
          value={metrics.daysToClose === null ? "—" : `${metrics.daysToClose}d`}
          detail={
            metrics.daysToClose === null
              ? "No close date set for this round"
              : metrics.daysToClose < 0
                ? "Past the target close date"
                : "Until the target close date"
          }
          muted={metrics.daysToClose === null}
        />
      </div>

      <div className="card-elevated overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <div className="text-sm font-semibold">At risk</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Commitments whose expected close date has passed without reaching wired.
            </div>
          </div>
          <div className={cn("grid h-8 w-8 place-items-center rounded-lg", metrics.atRiskCommitments.length > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>
        {metrics.atRiskCommitments.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing at risk right now.</div>
        ) : (
          <ul className="divide-y divide-border">
            {metrics.atRiskCommitments.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenCommitment(item.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{item.investorName}</div>
                    <div className="text-xs text-muted-foreground">
                      {COMMITMENT_STATUS_LABELS[item.status]} · {overdueLabel(item.daysOverdue)}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {item.amount === null ? "—" : money(item.amount, currency)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** "in 3 weeks" / "2 days ago" for a close date, or null when unset. */
function closeCountdown(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const days = Math.round((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (Number.isNaN(days)) return null;
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true };
  if (days === 0) return { text: "today", overdue: false };
  if (days < 14) return { text: `in ${days}d`, overdue: false };
  return { text: `in ${Math.round(days / 7)} weeks`, overdue: false };
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="grid gap-2"><Label>{label}</Label>{children}</div>; }
/**
 * `muted` dims the tile used for soft-circled, which is not raised money.
 * `onClick`, when given, turns the tile into a filter toggle for whatever
 * list sits below it; `active` reflects whether that filter is currently on.
 */
function Metric({
  title,
  value,
  detail,
  muted,
  active,
  onClick,
}: {
  title: string;
  value: string;
  detail: string;
  muted?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={cn(
        "card-elevated group relative w-full overflow-hidden p-5 text-left transition-colors hover:border-primary/30",
        muted && "border-dashed bg-transparent",
        active && "border-primary/60 ring-1 ring-primary/25",
      )}
    >
      <div className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="pr-10 text-sm font-medium text-muted-foreground">{title}</div>
      <div className={cn("mt-2 font-display text-2xl font-semibold tabular-nums", muted && "text-muted-foreground")}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </Wrapper>
  );
}
function Stat({ label, value }: { label: string; value: string }) { return <div><div className="text-muted-foreground">{label}</div><div className="mt-0.5 font-semibold tabular-nums">{value}</div></div>; }
function LoadingCard({ label }: { label: string }) { return <div className="rounded-xl border border-border/70 bg-surface/50 px-4 py-10 text-center text-sm text-muted-foreground">{label}</div>; }
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive"><p>{message}</p><Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>Retry</Button></div>; }
