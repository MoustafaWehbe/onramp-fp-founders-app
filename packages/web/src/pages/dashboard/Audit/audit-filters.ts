export type AuditFilters = {
  actions: string[];
  entityTypes: string[];
  from: Date | null;
  to: Date | null;
};

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  actions: [],
  entityTypes: [],
  from: null,
  to: null,
};
