import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select } from "./select";
import { cn } from "@/lib/utils";

/** The 24 hours of the day, e.g. { hours: 14, label: "2 PM" }. Kept as its own
 *  select, separate from minutes, so picking a time is two short lists
 *  instead of one 96-row scroll through every quarter-hour. */
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hours) => ({
  value: String(hours),
  label: new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(new Date(2000, 0, 1, hours)),
}));

/** Quarter-hour granularity, matching what this picker has always offered. */
const MINUTE_OPTIONS = [0, 15, 30, 45].map((minutes) => ({
  value: String(minutes),
  label: minutes.toString().padStart(2, "0"),
}));

/** Rounds down to the nearest quarter-hour so a value set elsewhere (not
 *  through this picker) still lands on one of MINUTE_OPTIONS. */
function nearestQuarterHour(minutes: number): number {
  return Math.floor(minutes / 15) * 15;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    date,
  );
}

type DateTimePickerProps = {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  minDate?: Date;
  id?: string;
  className?: string;
};

/**
 * A calendar + quarter-hour time list, styled to match the app instead of
 * relying on the browser's native date/time chrome which can't be themed
 * or restyled and looks jarring against a dark UI.
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick a date & time",
  minDate,
  id,
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);

  function selectDay(day: Date) {
    const next = new Date(day);
    if (value) next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    else next.setHours(9, 0, 0, 0);
    onChange(next);
  }

  function selectTime(hours: number, minutes: number) {
    const base = value ?? new Date();
    const next = new Date(base);
    next.setHours(hours, minutes, 0, 0);
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            "h-9 w-full justify-start px-3 font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {value ? `${formatDate(value)}, ${formatTime(value)}` : placeholder}
          </span>
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(null);
                }
              }}
              className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3">
        <div className="flex gap-3">
          <Calendar value={value} onSelect={selectDay} minDate={minDate} />

          <div className="w-36 shrink-0 border-l border-border/70 pl-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Time
            </div>
            <div className="flex gap-2">
              <Select
                aria-label="Hour"
                value={value ? String(value.getHours()) : ""}
                onValueChange={(hour) =>
                  selectTime(Number(hour), value ? nearestQuarterHour(value.getMinutes()) : 0)
                }
                options={HOUR_OPTIONS}
                placeholder="Hour"
                className="h-9 flex-1 px-2 text-xs"
              />
              <Select
                aria-label="Minute"
                value={value ? String(nearestQuarterHour(value.getMinutes())) : ""}
                onValueChange={(minute) =>
                  selectTime(value ? value.getHours() : 9, Number(minute))
                }
                options={MINUTE_OPTIONS}
                placeholder="Min"
                className="h-9 flex-1 px-2 text-xs"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
