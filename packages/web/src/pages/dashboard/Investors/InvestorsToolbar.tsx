import { Check, Filter, Search, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { STAGES, type PipelineStageId } from "../../../lib/mock-data";
import {
  INVESTOR_TYPES,
  INVESTOR_TYPE_LABELS,
  type InvestorType,
} from "../../../lib/investor-api";
import { cn } from "../../../lib/utils";

type Option<T extends string> = { value: T; label: string };

type FilterMenuProps<T extends string> = {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  showIcon?: boolean;
};

function FilterMenu<T extends string>({
  label,
  options,
  value,
  onChange,
  showIcon,
}: FilterMenuProps<T>) {
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(value && "border-primary/40 text-primary")}
        >
          {showIcon && <Filter className="h-3.5 w-3.5" />}
          {selected?.label ?? label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value === value ? null : option.value)}
          >
            <Check
              className={cn(
                "mr-2 h-4 w-4",
                option.value === value ? "opacity-100" : "opacity-0",
              )}
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Only filters the API can apply. Sector and firm used to be offered here, but
 * they filtered the loaded page rather than the query, so results silently
 * depended on how far you had paged.
 */
export type InvestorFilters = {
  stage: PipelineStageId | null;
  investorType: InvestorType | null;
};

const STAGE_OPTIONS: Option<PipelineStageId>[] = STAGES.map((stage) => ({
  value: stage.id,
  label: stage.label,
}));

const TYPE_OPTIONS: Option<InvestorType>[] = INVESTOR_TYPES.map((type) => ({
  value: type,
  label: INVESTOR_TYPE_LABELS[type],
}));

type InvestorsToolbarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  filters: InvestorFilters;
  onFilterChange: <K extends keyof InvestorFilters>(
    key: K,
    value: InvestorFilters[K],
  ) => void;
  onClearFilters: () => void;
  /** Stage only applies to contacts that are on the board. */
  showStageFilter?: boolean;
  selectedCount: number;
};

export function InvestorsToolbar({
  query,
  onQueryChange,
  filters,
  onFilterChange,
  onClearFilters,
  showStageFilter = true,
  selectedCount,
}: InvestorsToolbarProps) {
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search name, email or firm…"
          aria-label="Search investors"
          className="pl-9"
        />
      </div>

      {showStageFilter && (
        <FilterMenu
          label="Stage"
          showIcon
          options={STAGE_OPTIONS}
          value={filters.stage}
          onChange={(value) => onFilterChange("stage", value)}
        />
      )}
      <FilterMenu
        label="Type"
        showIcon={!showStageFilter}
        options={TYPE_OPTIONS}
        value={filters.investorType}
        onChange={(value) => onFilterChange("investorType", value)}
      />

      {activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}

      {selectedCount > 0 && (
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {selectedCount} selected
        </span>
      )}
    </div>
  );
}
