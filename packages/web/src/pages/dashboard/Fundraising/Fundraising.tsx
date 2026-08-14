import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
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
  createCommitment, createFundraisingRound, listCommitments, listFundraisingRounds,
  updateCommitment, updateFundraisingRound, type Commitment, type CommitmentInput,
  type CommitmentStatus, type FundraisingRound, type RoundInput, type RoundStatus,
} from "../../../lib/fundraising-api";
import { Select } from "../../../components/ui/select";
import { listPipelineEntries, type PipelineEntry } from "../../../lib/pipeline-api";
import { fetchAllPages } from "../../../lib/pagination";
import { cn, formatDate } from "../../../lib/utils";


function money(amount: number | null, currency: string) {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
function dateForInput(value: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ""; }
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
  const [roundDialog, setRoundDialog] = useState<FundraisingRound | "new" | null>(null);
  const [commitmentDialog, setCommitmentDialog] = useState<Commitment | "new" | null>(null);
  const roundsQuery = useQuery({ queryKey: ["fundraising-rounds", startupId], queryFn: () => listFundraisingRounds(startupId) });
  const rounds = roundsQuery.data?.data ?? [];
  const selectedRound = useMemo(() => rounds.find((round) => round.id === preferredRoundId) ?? rounds.find((round) => round.status === "active") ?? rounds[0] ?? null, [preferredRoundId, rounds]);
  useEffect(() => { if (selectedRound && selectedRound.id !== preferredRoundId) setActiveRoundId(startupId, selectedRound.id); }, [preferredRoundId, selectedRound, setActiveRoundId, startupId]);
  const commitmentsQuery = useQuery({ queryKey: ["commitments", startupId, selectedRound?.id], queryFn: () => listCommitments(startupId, selectedRound?.id), enabled: Boolean(selectedRound) });
  const pipelineQuery = useQuery({
    queryKey: ["pipeline", startupId, selectedRound?.id, "commitments"],
    queryFn: () => fetchAllPages((page, limit) => listPipelineEntries(startupId, { page, limit, roundId: selectedRound!.id })),
    enabled: Boolean(selectedRound),
  });
  const invalidateFinancial = () => {
    void queryClient.invalidateQueries({ queryKey: ["fundraising-rounds", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["commitments", startupId] });
    // Commitment writes move the linked deal's stage, so everything derived
    // from the board has to refetch too.
    void queryClient.invalidateQueries({ queryKey: ["pipeline", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["pipeline-focus", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["pipeline-analytics", startupId] });
  };
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
  const commitments = commitmentsQuery.data?.data ?? [];
  /**
   * Three numbers, not two. Soft-circled money is a verbal yes with nothing
   * signed — it belongs on screen, because it is the pipeline of near-money a
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

  return <div className="space-y-6">
    <PageHeader title="Fundraising rounds" description="Track targets, commitments, and cash closed for every raise." actions={canCreate ? <Button size="sm" onClick={() => setRoundDialog("new")}><Plus className="mr-1.5 h-4 w-4" /> New round</Button> : null} />
    {roundsQuery.isLoading && <LoadingCard label="Loading fundraising rounds…" />}
    {roundsQuery.isError && <ErrorCard message={apiErrorMessage(roundsQuery.error, "Could not load fundraising rounds.")} onRetry={() => void roundsQuery.refetch()} />}
    {!roundsQuery.isLoading && !roundsQuery.isError && rounds.length === 0 && <div className="card-elevated p-8 text-center"><h2 className="font-display text-lg font-semibold">Create your first raise</h2><p className="mt-1 text-sm text-muted-foreground">Set a target and currency, then add investors from the Pipeline.</p>{canCreate && <Button className="mt-4" onClick={() => setRoundDialog("new")}>Create a round</Button>}</div>}
    {rounds.length > 0 && <>
      <div className="grid gap-4 lg:grid-cols-3">{rounds.map((round) => {
        const isSelected = round.id === selectedRound?.id;
        const raised = isSelected ? totals.bankable : 0;
        const countdown = closeCountdown(round.firstCloseDate ?? round.targetCloseDate);
        return <button key={round.id} type="button" onClick={() => setActiveRoundId(startupId, round.id)} className={cn("card-elevated p-5 text-left transition-colors hover:border-primary/40", isSelected && "border-primary/60 ring-1 ring-primary/20")}><div className="mb-4 flex items-center justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Round</div><div className="font-display text-lg font-semibold tracking-tight">{round.roundName}</div></div><Badge className={cn("border-0 capitalize", roundTone(round.status))}>{round.status}</Badge></div><div className="mb-1 flex items-end justify-between gap-3"><div className="font-display text-2xl font-semibold tabular-nums">{isSelected ? money(raised, round.currency) : "Select round"}</div><div className="text-xs text-muted-foreground">of {money(round.targetAmount, round.currency)}</div></div>{isSelected ? <SegmentedProgress wiredPercent={totals.wiredPercent} hardPercent={totals.hardPercent} /> : <Progress value={0} className="h-2" />}<div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-xs"><Stat label="Min ticket" value={money(round.minimumTicketSize, round.currency)} /><Stat label="Equity" value={round.equityOfferedPercentage === null ? "—" : `${round.equityOfferedPercentage}%`} /><Stat label={round.firstCloseDate ? "First close" : "Target close"} value={countdown ? countdown.text : "—"} /></div></button>;
      })}</div>
      {selectedRound && <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">{selectedRound.roundName}</h2><p className="text-sm text-muted-foreground">Only signed money counts toward the target. Soft-circled is a verbal yes and is tracked separately.</p></div><div className="flex gap-2">{canUpdate && <Button size="sm" variant="outline" onClick={() => setRoundDialog(selectedRound)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit round</Button>}{canCreate && <Button size="sm" onClick={() => setCommitmentDialog("new")} disabled={pipelineQuery.isLoading || (pipelineQuery.data?.length ?? 0) === 0}><Plus className="mr-1.5 h-4 w-4" /> Add commitment</Button>}</div></div><section aria-label="Round totals" className="grid gap-4 sm:grid-cols-4"><Metric title="Wired" value={money(totals.wired, selectedRound.currency)} detail="In the bank" /><Metric title="Hard-circled" value={money(totals.hardCircled, selectedRound.currency)} detail="Signed, not yet wired" /><Metric title="Soft-circled" value={money(totals.softCircled, selectedRound.currency)} detail="Verbal — not counted" muted /><Metric title={totals.oversubscribed ? "Oversubscribed" : "Gap to target"} value={money(totals.oversubscribed ? totals.bankable - (selectedRound.targetAmount ?? 0) : totals.remaining, selectedRound.currency)} detail={`${totals.percent}% of ${money(selectedRound.targetAmount, selectedRound.currency)}`} /></section><div className="card-elevated overflow-hidden"><div className="flex items-center justify-between border-b border-border p-5"><div><div className="text-sm font-semibold">Commitments</div><div className="text-xs text-muted-foreground">Track verbal, signed, and funded commitments for this round.</div></div><div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary"><TrendingUp className="h-4 w-4" /></div></div><CommitmentTable commitments={commitments} currency={selectedRound.currency} canUpdate={canUpdate} onEdit={setCommitmentDialog} /></div></section>}
    </>}
    <RoundDialog round={roundDialog} open={roundDialog !== null} busy={createRoundMutation.isPending || updateRoundMutation.isPending} onOpenChange={(open) => !open && setRoundDialog(null)} onSubmit={(input) => { if (roundDialog === "new") createRoundMutation.mutate(input); else if (roundDialog) updateRoundMutation.mutate({ id: roundDialog.id, input }); }} />
    <CommitmentDialog commitment={commitmentDialog} open={commitmentDialog !== null} pipeline={pipelineQuery.data ?? []} round={selectedRound} busy={createCommitmentMutation.isPending || updateCommitmentMutation.isPending} onOpenChange={(open) => !open && setCommitmentDialog(null)} onCreate={createCommitmentMutation.mutate} onUpdate={(input) => commitmentDialog && commitmentDialog !== "new" && updateCommitmentMutation.mutate({ id: commitmentDialog.id, input })} />
  </div>;
}

function CommitmentTable({ commitments, currency, canUpdate, onEdit }: { commitments: Commitment[]; currency: string; canUpdate: boolean; onEdit: (commitment: Commitment) => void }) {
  if (!commitments.length) return <div className="p-8 text-center text-sm text-muted-foreground">No commitments yet. Add one from an investor already in this round’s pipeline.</div>;
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-surface/60 text-left text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Investor</th><th className="px-4 py-3 font-medium">Firm</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Amount</th><th className="px-4 py-3 font-medium">Expected close</th>{canUpdate && <th className="px-4 py-3" />}</tr></thead><tbody className="divide-y divide-border">{commitments.map((item) => <tr key={item.id} className="hover:bg-surface-hover/50"><td className="px-4 py-3 font-medium">{item.investor.fullName}</td><td className="px-4 py-3 text-muted-foreground">{item.investor.ventureFirm ?? "—"}</td><td className="px-4 py-3"><Badge variant="outline" className={cn("border-transparent", commitmentTone(item.status))}>{COMMITMENT_STATUS_LABELS[item.status]}</Badge></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(item.amount, currency)}</td><td className="px-4 py-3 text-muted-foreground">{item.expectedCloseDate ? formatDate(item.expectedCloseDate) : "—"}</td>{canUpdate && <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => onEdit(item)}>Edit</Button></td>}</tr>)}</tbody></table></div>;
}

function RoundDialog({ round, open, busy, onOpenChange, onSubmit }: { round: FundraisingRound | "new" | null; open: boolean; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (input: RoundInput) => void }) {
  const existing = round && round !== "new" ? round : null;
  const [form, setForm] = useState({ roundName: "", targetAmount: "", minimumTicketSize: "", equityOfferedPercentage: "", currency: "USD", status: "active" as RoundStatus, firstCloseDate: "", targetCloseDate: "" });
  useEffect(() => { setForm(existing ? { roundName: existing.roundName, targetAmount: String(existing.targetAmount ?? ""), minimumTicketSize: existing.minimumTicketSize === null ? "" : String(existing.minimumTicketSize), equityOfferedPercentage: existing.equityOfferedPercentage === null ? "" : String(existing.equityOfferedPercentage), currency: existing.currency, status: existing.status, firstCloseDate: dateForInput(existing.firstCloseDate), targetCloseDate: dateForInput(existing.targetCloseDate) } : { roundName: "", targetAmount: "", minimumTicketSize: "", equityOfferedPercentage: "", currency: "USD", status: "active", firstCloseDate: "", targetCloseDate: "" }); }, [existing, open]);
  function submit(event: FormEvent) { event.preventDefault(); const targetAmount = Number(form.targetAmount); if (!form.roundName.trim() || !Number.isFinite(targetAmount) || targetAmount < 0) return toast.error("Enter a round name and a valid target."); const minimumTicketSize = form.minimumTicketSize === "" ? undefined : Number(form.minimumTicketSize); const equityOfferedPercentage = form.equityOfferedPercentage === "" ? undefined : Number(form.equityOfferedPercentage); if ((minimumTicketSize !== undefined && (!Number.isFinite(minimumTicketSize) || minimumTicketSize < 0)) || (equityOfferedPercentage !== undefined && (!Number.isFinite(equityOfferedPercentage) || equityOfferedPercentage < 0 || equityOfferedPercentage > 100))) return toast.error("Enter valid optional ticket and equity values."); onSubmit({ roundName: form.roundName, targetAmount, ...(minimumTicketSize !== undefined ? { minimumTicketSize } : existing ? { minimumTicketSize: null } : {}), ...(equityOfferedPercentage !== undefined ? { equityOfferedPercentage } : existing ? { equityOfferedPercentage: null } : {}), currency: form.currency.toUpperCase(), status: form.status, ...(form.firstCloseDate ? { firstCloseDate: new Date(`${form.firstCloseDate}T00:00:00`).toISOString() } : existing ? { firstCloseDate: null } : {}), ...(form.targetCloseDate ? { targetCloseDate: new Date(`${form.targetCloseDate}T00:00:00`).toISOString() } : existing ? { targetCloseDate: null } : {}) }); }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{existing ? "Edit fundraising round" : "New fundraising round"}</DialogTitle><DialogDescription>Set the fundraising target and terms for this raise.</DialogDescription></DialogHeader><form className="grid gap-4" onSubmit={submit}><Field label="Round name"><Input value={form.roundName} onChange={(e) => setForm({ ...form, roundName: e.target.value })} placeholder="Seed round" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Target amount"><Input type="number" min="0" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} /></Field><Field label="Currency"><Input maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="Minimum ticket"><Input type="number" min="0" value={form.minimumTicketSize} onChange={(e) => setForm({ ...form, minimumTicketSize: e.target.value })} /></Field><Field label="Equity offered (%)"><Input type="number" min="0" max="100" value={form.equityOfferedPercentage} onChange={(e) => setForm({ ...form, equityOfferedPercentage: e.target.value })} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="First close"><Input type="date" value={form.firstCloseDate} onChange={(e) => setForm({ ...form, firstCloseDate: e.target.value })} /></Field><Field label="Target close"><Input type="date" value={form.targetCloseDate} onChange={(e) => setForm({ ...form, targetCloseDate: e.target.value })} /></Field></div><Field label="Status"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as RoundStatus })} options={ROUND_STATUSES.map((status) => ({ value: status, label: ROUND_STATUS_LABELS[status] }))} /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save round"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function CommitmentDialog({ commitment, open, pipeline, round, busy, onOpenChange, onCreate, onUpdate }: { commitment: Commitment | "new" | null; open: boolean; pipeline: PipelineEntry[]; round: FundraisingRound | null; busy: boolean; onOpenChange: (open: boolean) => void; onCreate: (input: CommitmentInput) => void; onUpdate: (input: { amount: number; status: CommitmentStatus; expectedCloseDate?: string | null }) => void }) {
  const existing = commitment && commitment !== "new" ? commitment : null;
  const [form, setForm] = useState({ pipelineId: "", amount: "", status: "soft_circled" as CommitmentStatus, expectedCloseDate: "" });
  useEffect(() => { setForm(existing ? { pipelineId: existing.pipelineId, amount: String(existing.amount ?? ""), status: existing.status, expectedCloseDate: dateForInput(existing.expectedCloseDate) } : { pipelineId: pipeline[0]?.id ?? "", amount: "", status: "soft_circled", expectedCloseDate: "" }); }, [existing, open, pipeline]);
  function submit(event: FormEvent) { event.preventDefault(); const amount = Number(form.amount); const deal = pipeline.find((item) => item.id === form.pipelineId); if (!Number.isFinite(amount) || amount < 0) return toast.error("Enter a valid commitment amount."); const expectedCloseDate = form.expectedCloseDate ? new Date(`${form.expectedCloseDate}T00:00:00`).toISOString() : undefined; if (existing) return onUpdate({ amount, status: form.status, expectedCloseDate: expectedCloseDate ?? null }); if (!deal || !round) return toast.error("Choose an investor from this round’s pipeline."); onCreate({ investorId: deal.investorId, pipelineId: deal.id, roundId: round.id, amount, status: form.status, ...(expectedCloseDate && { expectedCloseDate }) }); }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{existing ? "Edit commitment" : "Add commitment"}</DialogTitle><DialogDescription>{existing ? "Update its amount, status, or expected close." : "Commitments are tied to an investor’s deal in this round."}</DialogDescription></DialogHeader><form className="grid gap-4" onSubmit={submit}>{!existing && <Field label="Investor"><Select value={form.pipelineId} onValueChange={(value) => setForm({ ...form, pipelineId: value })} options={pipeline.map((deal) => ({ value: deal.id, label: `${deal.investor.fullName}${deal.investor.ventureFirm ? ` — ${deal.investor.ventureFirm}` : ""}` }))} /></Field>}<div className="grid grid-cols-2 gap-3"><Field label="Amount"><Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Expected close"><Input type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} /></Field></div><Field label="Status"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as CommitmentStatus })} options={COMMITMENT_STATUSES.map((status) => ({ value: status, label: `${COMMITMENT_STATUS_LABELS[status]} — ${COMMITMENT_STATUS_HINTS[status]}` }))} /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save commitment"}</Button></DialogFooter></form></DialogContent></Dialog>;
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
/** `muted` dims the tile — used for soft-circled, which is not raised money. */
function Metric({ title, value, detail, muted }: { title: string; value: string; detail: string; muted?: boolean }) { return <div className={cn("card-elevated p-5", muted && "border-dashed bg-transparent")}><div className="text-sm font-medium text-muted-foreground">{title}</div><div className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", muted && "text-muted-foreground")}>{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div>; }
function Stat({ label, value }: { label: string; value: string }) { return <div><div className="text-muted-foreground">{label}</div><div className="mt-0.5 font-semibold tabular-nums">{value}</div></div>; }
function LoadingCard({ label }: { label: string }) { return <div className="rounded-xl border border-border/70 bg-surface/50 px-4 py-10 text-center text-sm text-muted-foreground">{label}</div>; }
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive"><p>{message}</p><Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>Retry</Button></div>; }
