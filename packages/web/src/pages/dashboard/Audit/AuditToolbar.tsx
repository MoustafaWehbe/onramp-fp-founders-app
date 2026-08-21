import { Search, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { DatePicker } from "../../../components/ui/date-picker";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { MultiSelect } from "../../../components/ui/multi-select";
import type { AuditLogFacets } from "../../../lib/audit-api";
import { actionLabel, entityLabel } from "./audit-meta";
import { EMPTY_AUDIT_FILTERS, type AuditFilters } from "./audit-filters";

type AuditToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  filters: AuditFilters;
  onFiltersChange: (filters: AuditFilters) => void;
  facets: AuditLogFacets | undefined;
};

export function AuditToolbar({ search, onSearchChange, filters, onFiltersChange, facets }: AuditToolbarProps) {
  const hasActiveFilters =
    filters.actions.length > 0 || filters.entityTypes.length > 0 || filters.from || filters.to || search;

  return (
    <div className="card-elevated flex flex-col gap-3 p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search actions, users, entities…"
          className="h-9 border-border bg-surface pl-9"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">Action</Label>
          <MultiSelect
            options={(facets?.actions ?? []).map((value) => ({ value, label: actionLabel(value) }))}
            selected={filters.actions}
            onChange={(actions) => onFiltersChange({ ...filters, actions })}
            placeholder="All actions"
            searchPlaceholder="Search actions…"
          />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">Entity type</Label>
          <MultiSelect
            options={(facets?.entityTypes ?? []).map((value) => ({ value, label: entityLabel(value) }))}
            selected={filters.entityTypes}
            onChange={(entityTypes) => onFiltersChange({ ...filters, entityTypes })}
            placeholder="All entities"
            searchPlaceholder="Search entity types…"
          />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">From</Label>
          <DatePicker value={filters.from} onChange={(from) => onFiltersChange({ ...filters, from })} />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">To</Label>
          <DatePicker value={filters.to} onChange={(to) => onFiltersChange({ ...filters, to })} />
        </div>
      </div>

      {hasActiveFilters && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => {
              onSearchChange("");
              onFiltersChange(EMPTY_AUDIT_FILTERS);
            }}
          >
            <X className="mr-1 h-3 w-3" /> Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
