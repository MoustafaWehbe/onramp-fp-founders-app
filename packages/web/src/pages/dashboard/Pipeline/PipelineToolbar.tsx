import { Eye, EyeOff, Search, UserRoundCheck, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";

export type PipelineView = {
  search: string;
  attentionOnly: boolean;
  showPassed: boolean;
  mineOnly: boolean;
};

type PipelineToolbarProps = {
  view: PipelineView;
  onChange: <K extends keyof PipelineView>(key: K, value: PipelineView[K]) => void;
  /** Deals left after filtering, against the board total. */
  visibleCount: number;
  totalCount: number;
};

export function PipelineToolbar({
  view,
  onChange,
  visibleCount,
  totalCount,
}: PipelineToolbarProps) {
  const filtered = visibleCount !== totalCount;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={view.search}
          onChange={(event) => onChange("search", event.target.value)}
          placeholder="Search investor or firm…"
          aria-label="Search the pipeline"
          className="pl-9"
        />
        {view.search !== "" && (
          <button
            type="button"
            onClick={() => onChange("search", "")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-pressed={view.mineOnly}
        onClick={() => onChange("mineOnly", !view.mineOnly)}
        className={cn(view.mineOnly ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : "text-muted-foreground")}
      >
        <UserRoundCheck className="h-4 w-4" />
        {view.mineOnly ? "My deals" : "Assigned to me"}
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-pressed={view.showPassed}
        onClick={() => onChange("showPassed", !view.showPassed)}
        className={cn(!view.showPassed && "text-muted-foreground")}
      >
        {view.showPassed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        {view.showPassed ? "Passed shown" : "Passed hidden"}
      </Button>

      <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {filtered ? `${visibleCount} of ${totalCount}` : `${totalCount}`} deal
        {totalCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
