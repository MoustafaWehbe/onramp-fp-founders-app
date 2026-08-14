import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarClock,
  Crown,
  ListPlus,
  Mail,
  MessageSquare,
  MoveRight,
  Phone,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import type { InteractionType } from "../../../lib/interaction-log-api";
import { STAGES, type PipelineStageId } from "../../../lib/mock-data";
import type { FocusReason, PipelineEntry } from "../../../lib/pipeline-api";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";
import { FOCUS_REASON_LABELS, FOCUS_REASON_TONES, formatDaysAgo, type DealSignals } from "./deal-signals";

const TOUCH_ICONS: Record<InteractionType, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  other: MessageSquare,
};

type DealCardBodyProps = {
  deal: PipelineEntry;
  signals: DealSignals;
  /** Why this deal is in Focus, server-computed; null when it doesn't qualify. */
  focusReason: FocusReason | null;
  /**
   * Who owns this deal, already resolved to a display name — a primitive so
   * the memo below still short-circuits on an unchanged card.
   */
  ownerName: string | null;
  canUpdate: boolean;
  /** Whether this card is picked for a bulk action; null hides selection entirely. */
  selected?: boolean | null;
  /**
   * Every callback takes the deal id rather than being pre-bound per card, so
   * a parent list can hand every card the exact same function reference
   * instead of a fresh closure each render — that's what lets DealCard's
   * memo actually skip re-rendering cards a drag never touched.
   */
  onOpen: (dealId: string) => void;
  onMove: (dealId: string, stage: PipelineStageId) => void;
  /** Opens the task composer for this deal without opening the deal itself. */
  onAddTask?: (dealId: string) => void;
  onToggleSelected?: (dealId: string) => void;
  /**
   * True only for the floating copy that follows the cursor while dragging.
   * That copy is purely presentational — its menu and checkbox can never be
   * clicked — so it skips mounting the interactive dropdown (a Radix portal)
   * and always shows the plain avatar, trading nothing visible for less
   * dragged-frame render weight.
   */
  dragOverlay?: boolean;
};

/**
 * Everything a deal card shows — shared between the live sortable card, the
 * floating drag copy, and the mobile list row (none of which is the card
 * being dragged in place, which renders a bare placeholder instead — see
 * DealCard below).
 */
export function DealCardBody({
  deal,
  signals,
  focusReason,
  ownerName,
  canUpdate,
  selected,
  onOpen,
  onMove,
  onAddTask,
  onToggleSelected,
  dragOverlay = false,
}: DealCardBodyProps) {
  const investor = deal.investor;
  const probability = deal.probabilityPercentage ?? 0;
  const TouchIcon = signals.lastTouchType ? TOUCH_ICONS[signals.lastTouchType] : null;

  return (
    <>
      <div className="flex items-center gap-2">
        {selected == null || dragOverlay ? (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-[10px] font-semibold text-primary">
            {getInitials(investor.fullName)}
          </div>
        ) : (
          // In selection mode the avatar gives up its slot: a checkbox in the
          // same place keeps the card's height and layout identical, so
          // entering selection never reflows the board.
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelected?.(deal.id)}
            // The card body is a drag handle and the identity button covers
            // the whole card, so the checkbox has to stop both.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${investor.fullName}`}
            className="relative z-10 h-7 w-7 shrink-0"
          />
        )}

        {/* The whole identity block opens the deal; the drag handle and the move
            menu stay clickable because they sit outside this button. */}
        <button
          type="button"
          onClick={() => onOpen(deal.id)}
          className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label={`Open ${investor.fullName}`}
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{investor.fullName}</span>
            {deal.isLead && (
              <Crown
                className="h-3.5 w-3.5 shrink-0 text-warning"
                aria-label="Leading this round"
              />
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {investor.ventureFirm ?? "Independent"}
          </div>
        </button>

        {canUpdate && dragOverlay && (
          <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center text-muted-foreground">
            <MoveRight className="h-4 w-4" />
          </span>
        )}

        {canUpdate && !dragOverlay && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative z-10 h-7 w-7 shrink-0 text-muted-foreground"
                aria-label={`Actions for ${investor.fullName}`}
              >
                <MoveRight className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {onAddTask && (
                <>
                  {/* Setting the next step is the most common thing to do to a
                      card, and it used to mean opening the deal first. */}
                  <DropdownMenuItem onSelect={() => onAddTask(deal.id)}>
                    <ListPlus className="mr-2 h-4 w-4" />
                    Add task
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STAGES.map((target) => (
                <DropdownMenuItem
                  key={target.id}
                  disabled={target.id === deal.stage}
                  onSelect={() => onMove(deal.id, target.id)}
                >
                  <span className={cn("mr-2 h-2 w-2 rounded-full", target.dotClass)} />
                  {target.label}
                  {target.id === deal.stage && (
                    <span className="ml-auto text-xs text-muted-foreground">Current</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="font-mono text-muted-foreground">
          {deal.expectedAmount != null ? formatCompactUsd(deal.expectedAmount) : "—"}
        </span>
        <div className="flex items-center gap-1.5">
          {/* Ownership was settable but invisible everywhere outside the deal
              sheet, so "who has this one" needed opening every card to answer. */}
          {ownerName && (
            <span
              title={`Owned by ${ownerName}`}
              aria-label={`Owned by ${ownerName}`}
              className="grid h-5 w-5 place-items-center rounded-full bg-surface-hover font-display text-[9px] font-semibold text-muted-foreground"
            >
              {getInitials(ownerName)}
            </span>
          )}
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {probability}%
          </span>
        </div>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            deal.stage === "passed" ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${probability}%` }}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {focusReason && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
              FOCUS_REASON_TONES[focusReason],
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {FOCUS_REASON_LABELS[focusReason]}
          </span>
        )}

        <span className="inline-flex items-center gap-1 text-muted-foreground">
          {TouchIcon ? (
            <>
              <TouchIcon className="h-3 w-3" />
              {formatDaysAgo(signals.daysQuiet)}
            </>
          ) : (
            <>
              <MessageSquare className="h-3 w-3" />
              Never contacted
            </>
          )}
        </span>
      </div>
    </>
  );
}

type DealCardProps = DealCardBodyProps;

/**
 * The card as it sits in a column — draggable via dnd-kit, wherever you want
 * to drop it. Memoized: onDragOver fires on every pointer move and updates
 * the board's column state, which would otherwise re-render every card in
 * every column on every frame rather than just the ones whose position
 * actually changed.
 */
export const DealCard = memo(function DealCard(props: DealCardProps) {
  const { deal, focusReason, canUpdate, selected } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    disabled: !canUpdate,
    // Fast enough to keep up with the pointer while still making the new slot
    // legible. A 300ms transition stacked behind repeated drag-over updates.
    transition: { duration: 160, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  });

  return (
    <Card
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        willChange: isDragging || transform ? "transform" : undefined,
      }}
      {...attributes}
      {...listeners}
      className={cn(
        // A fixed floor means the placeholder below never has to measure the
        // card it's standing in for, and no card visibly resizes as its
        // owner badge or focus-reason chip come and go.
        "relative min-h-[128px] touch-none border-border/70 bg-card/95 p-3 shadow-sm transition-[border-color,opacity,background-color] hover:border-primary/40",
        canUpdate && "cursor-grab active:cursor-grabbing",
        isDragging
          ? // The card being dragged stays in the DOM (dnd-kit needs its layout
            // to keep measuring), but shows only a dashed outline in the slot
            // it's about to fill — the drop position, not just a blank gap —
            // while the DragOverlay copy follows the cursor instead.
            "border-2 border-dashed border-primary/40 bg-primary/[0.04] shadow-none"
          : focusReason && "border-l-2 border-l-warning",
        selected && !isDragging && "border-primary ring-1 ring-primary/40",
      )}
    >
      {!isDragging && <DealCardBody {...props} />}
    </Card>
  );
});

/** The floating copy that follows the cursor while dragging — no sortable
 *  bindings of its own, just the same visuals lifted off the board. */
export function DealCardOverlay(props: DealCardProps) {
  return (
    <Card className="relative min-h-[128px] scale-[1.02] cursor-grabbing border-primary/50 bg-card p-3 shadow-2xl will-change-transform">
      <DealCardBody {...props} dragOverlay />
    </Card>
  );
}
