import { Check, CheckSquare, Filter, Search, Trash2, X } from "lucide-react";
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
import { STATUS_FILTER_OPTIONS, TYPE_OPTIONS } from "./document-types";

type Option = { value: string; label: string };

type FilterMenuProps = {
  label: string;
  options: Option[];
  value: string | null;
  onChange: (value: string | null) => void;
  showIcon?: boolean;
};

function FilterMenu({ label, options, value, onChange, showIcon }: FilterMenuProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(value && "border-primary/40 text-primary")}>
          {showIcon && <Filter className="h-3.5 w-3.5" />}
          {selected?.label ?? label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value === value ? null : option.value)}>
            <Check className={cn("mr-2 h-4 w-4", option.value === value ? "opacity-100" : "opacity-0")} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type DocumentFilters = {
  documentType: string | null;
  status: string | null;
};

type DocumentsToolbarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  filters: DocumentFilters;
  onFilterChange: <K extends keyof DocumentFilters>(key: K, value: DocumentFilters[K]) => void;
  onClearFilters: () => void;
  canSelect: boolean;
  selectionActive: boolean;
  onToggleSelection: () => void;
  onSelectAllVisible: () => void;
  visibleCount: number;
  selectedCount: number;
  onBulkDelete: () => void;
  bulkDeleting: boolean;
};

export function DocumentsToolbar({
  query,
  onQueryChange,
  filters,
  onFilterChange,
  onClearFilters,
  canSelect,
  selectionActive,
  onToggleSelection,
  onSelectAllVisible,
  visibleCount,
  selectedCount,
  onBulkDelete,
  bulkDeleting,
}: DocumentsToolbarProps) {
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search documents…"
          aria-label="Search documents"
          className="pl-9"
        />
      </div>

      <FilterMenu
        label="Type"
        showIcon
        options={TYPE_OPTIONS}
        value={filters.documentType}
        onChange={(value) => onFilterChange("documentType", value)}
      />
      <FilterMenu
        label="Status"
        options={STATUS_FILTER_OPTIONS}
        value={filters.status}
        onChange={(value) => onFilterChange("status", value)}
      />

      {activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}

      {canSelect && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={selectionActive}
          onClick={onToggleSelection}
          className={cn(
            selectionActive
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
              : "text-muted-foreground",
          )}
        >
          <CheckSquare className="h-3.5 w-3.5" />
          {selectionActive ? "Selecting" : "Select"}
        </Button>
      )}

      {selectionActive && (
        <div className="ml-auto flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.05] px-3 py-1.5">
          <span className="font-mono text-xs text-muted-foreground">{selectedCount} selected</span>
          <Button type="button" variant="ghost" size="sm" disabled={visibleCount === 0} onClick={onSelectAllVisible}>
            Select all
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={bulkDeleting || selectedCount === 0}
            onClick={onBulkDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {bulkDeleting ? "Deleting…" : "Delete"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onToggleSelection} aria-label="Leave selection mode">
            <X className="h-3.5 w-3.5" /> Done
          </Button>
        </div>
      )}
    </div>
  );
}
