import type { DragEvent } from "react";
import {
  CalendarClock,
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
import type { PipelineEntry } from "../../../lib/pipeline-api";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";
import { followupLabel, formatDaysAgo, type DealSignals } from "./deal-signals";

const TOUCH_ICONS: Record<InteractionType, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  other: MessageSquare,
};

const FOLLOWUP_TONES: Record<string, string> = {
  overdue: "bg-destructive/15 text-destructive",
  today: "bg-warning/15 text-warning",
  upcoming: "bg-muted text-muted-foreground",
};

type DealCardProps = {
  deal: PipelineEntry;
  signals: DealSignals;
  canUpdate: boolean;
  isDragging: boolean;
  onOpen: () => void;
  onMove: (stage: PipelineStageId) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

export function DealCard({
  deal,
  signals,
  canUpdate,
  isDragging,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: DealCardProps) {
  const investor = deal.investor;
  const probability = deal.probabilityPercentage ?? 0;
  const followup = followupLabel(signals);
  const TouchIcon = signals.lastTouchType ? TOUCH_ICONS[signals.lastTouchType] : null;

  return (
    <Card
      draggable={canUpdate}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // Read by the column's onDragOver to find which card the pointer is
      // over, so a card drops next to the cursor instead of at the top.
      data-deal-card={deal.id}
      className={cn(
        "relative border-border/70 bg-card/95 p-3 shadow-sm transition-[border-color,opacity,transform] hover:-translate-y-0.5 hover:border-primary/40",
        canUpdate && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
        signals.needsAttention && "border-l-2 border-l-warning",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-[10px] font-semibold text-primary">
          {getInitials(investor.fullName)}
        </div>

        {/* The whole identity block opens the deal; the drag handle and the move
            menu stay clickable because they sit outside this button. */}
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label={`Open ${investor.fullName}`}
        >
          <div className="truncate text-sm font-medium text-foreground">{investor.fullName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {investor.ventureFirm ?? "Independent"}
          </div>
        </button>

        {canUpdate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative z-10 h-7 w-7 shrink-0 text-muted-foreground"
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
                  onSelect={() => onMove(target.id)}
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
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {probability}%
        </span>
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
        {followup ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
              FOLLOWUP_TONES[signals.followup] ?? FOLLOWUP_TONES.upcoming,
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {followup}
          </span>
        ) : (
          signals.needsAttention && (
            <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-warning">
              <CalendarClock className="h-3 w-3" />
              No next step
            </span>
          )
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
    </Card>
  );
}
