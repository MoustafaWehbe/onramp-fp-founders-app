import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "@/lib/utils";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    date,
  );
}

type DatePickerProps = {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  minDate?: Date;
  id?: string;
  className?: string;
};

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  minDate,
  id,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  function selectDay(day: Date) {
    const next = new Date(day);
    next.setHours(0, 0, 0, 0);
    onChange(next);
    setOpen(false);
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
          <span className="truncate">{value ? formatDate(value) : placeholder}</span>
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
        <Calendar value={value} onSelect={selectDay} minDate={minDate} />
      </PopoverContent>
    </Popover>
  );
}
