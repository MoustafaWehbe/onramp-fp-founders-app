import { useCallback, useMemo, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { MoveRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import {
  DEFAULT_PROBABILITY_BY_STAGE,
  STAGES,
  type PipelineStageId,
} from "../../../lib/mock-data";
import {
  createPipelineEntry,
  listInvestorContacts,
  listPipelineEntries,
  updatePipelineEntry,
  type PipelineEntry,
} from "../../../lib/pipeline-api";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";

function apiErrorMessage(err: unknown, fallback: string) {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { error?: string; message?: string; code?: string } | undefined;
    if (status === 403) {
      return "Forbidden — this account is not an active member of the current startup (or lacks pipeline permission).";
    }
    if (status === 401) {
      return "Not signed in — please log in again.";
    }
    return data?.error ?? data?.message ?? fallback;
  }
  return fallback;
}

export function Pipeline() {
  const startupId = useActiveStartupId();
  const queryClient = useQueryClient();
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PipelineStageId | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedInvestorId, setSelectedInvestorId] = useState("");
  const [newStage, setNewStage] = useState<PipelineStageId>("sourced");
  const [newAmount, setNewAmount] = useState("");

  const pipelineQuery = useQuery({
    queryKey: ["pipeline", startupId],
    queryFn: () => listPipelineEntries(startupId, { page: 1, limit: 100 }),
  });

  const contactsQuery = useQuery({
    queryKey: ["investors", startupId, "for-pipeline"],
    queryFn: () => listInvestorContacts(startupId, { page: 1, limit: 100 }),
    enabled: addOpen,
  });

  const entries = pipelineQuery.data?.data ?? [];

  const dealsByStage = useMemo(() => {
    const grouped = new Map<PipelineStageId, PipelineEntry[]>(
      STAGES.map((stage) => [stage.id, []]),
    );
    for (const entry of entries) {
      const bucket = grouped.get(entry.stage as PipelineStageId);
      if (bucket) bucket.push(entry);
      else grouped.get("sourced")?.push(entry);
    }
    return grouped;
  }, [entries]);

  const availableContacts = useMemo(
    () => (contactsQuery.data?.data ?? []).filter((contact) => !contact.pipeline),
    [contactsQuery.data],
  );

  const selectedContact = availableContacts.find((c) => c.id === selectedInvestorId);
  const selectedStage = STAGES.find((stage) => stage.id === newStage) ?? STAGES[0];

  const invalidatePipeline = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["pipeline", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["investors", startupId] });
  }, [queryClient, startupId]);

  const moveMutation = useMutation({
    mutationFn: ({
      pipelineId,
      stage,
    }: {
      pipelineId: string;
      stage: PipelineStageId;
      previous?: PipelineEntry[];
    }) =>
      updatePipelineEntry(startupId, pipelineId, {
        stage,
        probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE[stage],
      }),
    onMutate: async ({ pipelineId, stage }) => {
      await queryClient.cancelQueries({ queryKey: ["pipeline", startupId] });
      const previous = queryClient.getQueryData<{ data: PipelineEntry[] }>([
        "pipeline",
        startupId,
      ]);

      queryClient.setQueryData<{ data: PipelineEntry[]; meta?: unknown }>(
        ["pipeline", startupId],
        (current) => {
          if (!current) return current;
          return {
            ...current,
            data: current.data.map((entry) =>
              entry.id === pipelineId
                ? {
                    ...entry,
                    stage,
                    probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE[stage],
                  }
                : entry,
            ),
          };
        },
      );

      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["pipeline", startupId], context.previous);
      }
      toast.error(apiErrorMessage(err, "Could not move deal"));
    },
    onSettled: () => {
      invalidatePipeline();
      setDraggedDealId(null);
      setDropTarget(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const amount = newAmount.trim() === "" ? undefined : Number(newAmount);
      if (amount !== undefined && Number.isNaN(amount)) {
        throw new Error("Expected amount must be a number");
      }
      return createPipelineEntry(startupId, {
        investorId: selectedInvestorId,
        stage: newStage,
        expectedAmount: amount,
        probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE[newStage],
      });
    },
    onSuccess: () => {
      toast.success("Added to pipeline");
      setAddOpen(false);
      setSelectedInvestorId("");
      setNewStage("sourced");
      setNewAmount("");
      invalidatePipeline();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not add to pipeline"));
    },
  });

  const moveDeal = useCallback(
    (pipelineId: string, stage: PipelineStageId) => {
      const current = entries.find((entry) => entry.id === pipelineId);
      if (!current || current.stage === stage) return;
      moveMutation.mutate({ pipelineId, stage });
    },
    [entries, moveMutation],
  );

  const handleDragStart = (event: DragEvent<HTMLElement>, dealId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dealId);
    setDraggedDealId(dealId);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, stageId: PipelineStageId) => {
    event.preventDefault();
    const dealId = event.dataTransfer.getData("text/plain") || draggedDealId;
    if (!dealId) return;
    moveDeal(dealId, stageId);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deal pipeline"
        description="Drag investors through stages, or use a card's move menu. Data is live from the API."
        actions={
          <Button size="sm" type="button" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add to pipeline
          </Button>
        }
      />

      {pipelineQuery.isLoading && (
        <div className="rounded-xl border border-border/70 bg-surface/50 px-4 py-10 text-center text-sm text-muted-foreground">
          Loading pipeline…
        </div>
      )}

      {pipelineQuery.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          <p>{apiErrorMessage(pipelineQuery.error, "Failed to load pipeline.")}</p>
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: ["pipeline", startupId] })
              }
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      {!pipelineQuery.isLoading && !pipelineQuery.isError && (
        <div className="scrollbar-slim flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const stageDeals = dealsByStage.get(stage.id) ?? [];
            const weightedTotal = stageDeals.reduce((sum, deal) => {
              const amount = deal.expectedAmount ?? 0;
              const probability = deal.probabilityPercentage ?? 0;
              return sum + amount * (probability / 100);
            }, 0);

            return (
              <section
                key={stage.id}
                className="w-[min(18rem,85vw)] flex-none snap-start sm:w-72"
                aria-labelledby={`pipeline-stage-${stage.id}`}
              >
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", stage.dotClass)} />
                    <h2
                      id={`pipeline-stage-${stage.id}`}
                      className="truncate font-display text-sm font-semibold text-foreground"
                    >
                      {stage.label}
                    </h2>
                    <span className="font-mono text-xs text-muted-foreground">
                      {stageDeals.length}
                    </span>
                  </div>
                  {weightedTotal > 0 && (
                    <span
                      className="shrink-0 font-mono text-xs text-muted-foreground"
                      title="Probability-weighted forecast"
                    >
                      {formatCompactUsd(weightedTotal)}
                    </span>
                  )}
                </div>

                <div
                  className={cn(
                    "min-h-[24rem] space-y-2 rounded-xl border border-border/70 bg-surface/50 p-2 transition-colors",
                    dropTarget === stage.id && "border-primary/50 bg-primary/[0.04]",
                  )}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDropTarget(stage.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                      setDropTarget(null);
                    }
                  }}
                  onDrop={(event) => handleDrop(event, stage.id)}
                >
                  {stageDeals.map((deal) => {
                    const investor = deal.investor;
                    return (
                      <Card
                        key={deal.id}
                        draggable
                        onDragStart={(event) => handleDragStart(event, deal.id)}
                        onDragEnd={() => {
                          setDraggedDealId(null);
                          setDropTarget(null);
                        }}
                        className={cn(
                          "cursor-grab border-border/70 bg-card/95 p-3 shadow-sm transition-[border-color,opacity,transform] hover:-translate-y-0.5 hover:border-primary/40 active:cursor-grabbing",
                          draggedDealId === deal.id && "opacity-50",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-[10px] font-semibold text-primary">
                            {getInitials(investor.fullName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {investor.fullName}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {investor.ventureFirm ?? "Independent"}
                            </div>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground"
                                aria-label={`Move ${investor.fullName} to another stage`}
                              >
                                <MoveRight className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-48">
                              <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {STAGES.map((target) => (
                                <DropdownMenuItem
                                  key={target.id}
                                  disabled={target.id === deal.stage}
                                  onSelect={() => moveDeal(deal.id, target.id)}
                                >
                                  <span
                                    className={cn("mr-2 h-2 w-2 rounded-full", target.dotClass)}
                                  />
                                  {target.label}
                                  {target.id === deal.stage && (
                                    <span className="ml-auto text-xs text-muted-foreground">
                                      Current
                                    </span>
                                  )}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono text-muted-foreground">
                            {deal.expectedAmount != null
                              ? formatCompactUsd(deal.expectedAmount)
                              : "—"}
                          </span>
                          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {deal.probabilityPercentage ?? 0}%
                          </span>
                        </div>
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-300",
                              stage.id === "passed" ? "bg-destructive" : "bg-primary",
                            )}
                            style={{ width: `${deal.probabilityPercentage ?? 0}%` }}
                          />
                        </div>
                      </Card>
                    );
                  })}

                  {stageDeals.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      Drop an investor here
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add to pipeline</DialogTitle>
            <DialogDescription>
              Choose a contact that is not already on the board, then pick a starting stage.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Investor contact</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-9 w-full justify-between px-3 py-2 text-left font-normal"
                  >
                    <span className="min-w-0 truncate">
                      {selectedContact
                        ? `${selectedContact.fullName}${
                            selectedContact.ventureFirm
                              ? ` — ${selectedContact.ventureFirm}`
                              : ""
                          }`
                        : contactsQuery.isLoading
                          ? "Loading contacts…"
                          : "Select a contact"}
                    </span>
                    <MoveRight className="h-4 w-4 shrink-0 rotate-90 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto"
                >
                  <DropdownMenuLabel>Available contacts</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {contactsQuery.isError && (
                    <DropdownMenuItem disabled>
                      Failed to load contacts — check you are signed in
                    </DropdownMenuItem>
                  )}
                  {!contactsQuery.isLoading &&
                    !contactsQuery.isError &&
                    availableContacts.length === 0 && (
                      <DropdownMenuItem disabled>
                        Every contact already has a pipeline entry
                      </DropdownMenuItem>
                    )}
                  {availableContacts.map((contact) => (
                    <DropdownMenuItem
                      key={contact.id}
                      onSelect={() => setSelectedInvestorId(contact.id)}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{contact.fullName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {contact.ventureFirm ?? contact.email ?? "No firm"}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {!contactsQuery.isLoading && availableContacts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {availableContacts.length} contact
                  {availableContacts.length === 1 ? "" : "s"} ready to add
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Starting stage</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full justify-between px-3 font-normal"
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", selectedStage.dotClass)} />
                      {selectedStage.label}
                    </span>
                    <MoveRight className="h-4 w-4 shrink-0 rotate-90 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[var(--radix-dropdown-menu-trigger-width)]"
                >
                  {STAGES.map((stage) => (
                    <DropdownMenuItem
                      key={stage.id}
                      onSelect={() => setNewStage(stage.id)}
                    >
                      <span className={cn("mr-2 h-2 w-2 rounded-full", stage.dotClass)} />
                      {stage.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="pipeline-amount">
                Expected amount (optional)
              </label>
              <Input
                id="pipeline-amount"
                type="number"
                min={0}
                step={1000}
                placeholder="250000"
                value={newAmount}
                onChange={(event) => setNewAmount(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedInvestorId || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Adding…" : "Add to pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
