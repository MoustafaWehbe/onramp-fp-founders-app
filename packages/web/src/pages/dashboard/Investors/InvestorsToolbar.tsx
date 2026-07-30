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
import { cn } from "../../../lib/utils";

type FilterMenuProps = {
  label: string;
  options: string[];
  value: string | null;
  onChange: (value: string | null) => void;
  showIcon?: boolean;
};

function FilterMenu({ label, options, value, onChange, showIcon }: FilterMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(value && "border-primary/40 text-primary")}
        >
          {showIcon && <Filter className="h-3.5 w-3.5" />}
          {value ?? label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => onChange(option === value ? null : option)}
          >
            <Check
              className={cn("mr-2 h-4 w-4", option === value ? "opacity-100" : "opacity-0")}
            />
            {option}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type InvestorFilters = {
  stage: string | null;
  sector: string | null;
  firm: string | null;
};

type InvestorsToolbarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  filters: InvestorFilters;
  onFilterChange: (key: keyof InvestorFilters, value: string | null) => void;
  onClearFilters: () => void;
  stageOptions: string[];
  sectorOptions: string[];
  firmOptions: string[];
  selectedCount: number;
};

export function InvestorsToolbar({
  query,
  onQueryChange,
  filters,
  onFilterChange,
  onClearFilters,
  stageOptions,
  sectorOptions,
  firmOptions,
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
          placeholder="Search investors, firms…"
          aria-label="Search investors"
          className="pl-9"
        />
      </div>

      <FilterMenu
        label="Stage"
        showIcon
        options={stageOptions}
        value={filters.stage}
        onChange={(value) => onFilterChange("stage", value)}
      />
      <FilterMenu
        label="Sector"
        options={sectorOptions}
        value={filters.sector}
        onChange={(value) => onFilterChange("sector", value)}
      />
      <FilterMenu
        label="Firm"
        options={firmOptions}
        value={filters.firm}
        onChange={(value) => onFilterChange("firm", value)}
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
