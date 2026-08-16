import type { LucideIcon } from "lucide-react";

type StatTileProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: "success" | "warning" | "muted";
};

const TONE_CLASS = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning",
  muted: "bg-muted text-muted-foreground",
} as const;

/** One stat-tile layout for every "number in a card" moment — icon, label, value. */
export function StatTile({ label, value, icon: Icon, tone }: StatTileProps) {
  return (
    <div className="card-elevated flex items-center gap-3 p-4">
      <div className={`grid h-10 w-10 place-items-center rounded-md ${TONE_CLASS[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}
