import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The track + thumb visual on its own. Split out so a larger control (a whole
 * clickable settings row, say) can own the `role="switch"` semantics and render
 * this as decoration, instead of nesting two focusable elements.
 */
function SwitchIndicator({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200",
        checked ? "border-primary bg-primary" : "border-border bg-secondary",
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-3.5 w-3.5 rounded-full shadow-xs transition-transform duration-200",
          checked
            ? "translate-x-4.5 bg-primary-foreground"
            : "translate-x-0.5 bg-muted-foreground",
        )}
      />
    </span>
  );
}

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type" | "value"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        "rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchIndicator checked={checked} />
    </button>
  ),
);
Switch.displayName = "Switch";

export { Switch, SwitchIndicator };
