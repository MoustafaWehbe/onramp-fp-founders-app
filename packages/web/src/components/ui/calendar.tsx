import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** 6 full weeks (42 days) spanning the target month, including the leading and trailing days needed to fill each row. */
function buildGrid(monthStart: Date): Date[] {
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

type CalendarProps = {
  /** The selected date, or null for none. */
  value: Date | null;
  onSelect: (date: Date) => void;
  /** Days before this are not selectable. */
  minDate?: Date;
  className?: string;
};

export function Calendar({ value, onSelect, minDate, className }: CalendarProps) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(value ?? new Date()));

  const today = new Date();
  const grid = buildGrid(viewMonth);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    viewMonth,
  );

  const changeMonth = (delta: number) => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  return (
    <div className={cn("w-64", className)}>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => changeMonth(-1)}
          aria-label="Previous month"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-display text-sm font-semibold text-foreground">{monthLabel}</span>
        <button
          type="button"
          onClick={() => changeMonth(1)}
          aria-label="Next month"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="grid h-7 place-items-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </div>
        ))}

        {grid.map((day) => {
          const inMonth = day.getMonth() === viewMonth.getMonth();
          const isToday = isSameDay(day, today);
          const isSelected = value !== null && isSameDay(day, value);
          const disabled = minDate !== undefined && day < minDate && !isSameDay(day, minDate);

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              aria-label={day.toDateString()}
              aria-pressed={isSelected}
              onClick={() => onSelect(day)}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md text-xs transition-colors",
                inMonth ? "text-foreground" : "text-muted-foreground/50",
                !isSelected && "hover:bg-surface-hover",
                isToday && !isSelected && "font-semibold text-primary",
                isSelected && "bg-primary font-semibold text-primary-foreground",
                disabled && "pointer-events-none opacity-30",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
