import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "@/lib/utils";

/** Every quarter-hour of the day, e.g. { hours: 9, minutes: 30, label: "9:30 AM" }. */
const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  const label = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, hours, minutes),
  );
  return { hours, minutes, label };
});

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
 * relying on the browser's native date/time chrome — which can't be themed
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

          <div className="w-24 shrink-0 border-l border-border/70 pl-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Time
            </div>
            <div className="scrollbar-slim flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {TIME_OPTIONS.map((option) => {
                const selected =
                  value !== null &&
                  value.getHours() === option.hours &&
                  value.getMinutes() === option.minutes;
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => selectTime(option.hours, option.minutes)}
                    className={cn(
                      "shrink-0 rounded-md px-2 py-1 text-left text-xs transition-colors",
                      selected
                        ? "bg-primary font-medium text-primary-foreground"
                        : "text-foreground hover:bg-surface-hover",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
