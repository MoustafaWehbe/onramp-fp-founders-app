import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { FileText, Loader2, Search, Users, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "../../hooks/usePermissions";
import { useWorkspace } from "../../hooks/useWorkspace";
import { listDocuments } from "../../lib/document-api";
import { INVESTOR_TYPE_LABELS, listInvestors, type InvestorType } from "../../lib/investor-api";
import { TYPE_LABELS } from "../../pages/dashboard/Documents/document-types";
import { cn, getInitials } from "../../lib/utils";
import { Button } from "../ui/button";

const RESULT_LIMIT = 6;
const DEBOUNCE_MS = 250;

const DOCUMENT_SECTION_QUERY = /^(docs?|documents?)$/i;
const INVESTOR_SECTION_QUERY = /^(investors?|contacts?)$/i;

type SearchHit = {
  kind: "investor" | "document";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

/**
 * Header search across investors and documents the caller can read.
 * Clicking a hit opens that page with a deep-link query so the detail
 * dialog / versions sheet appears immediately.
 *
 * Lives in AppLayout (outside RequireWorkspace), so it must tolerate a
 * missing active startup instead of calling useActiveStartupId().
 */
export function GlobalSearch() {
  const { activeStartupId: startupId } = useWorkspace();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const listId = useId();
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const canInvestors = Boolean(startupId) && can("pipeline", "read");
  const canDocuments = Boolean(startupId) && can("documents", "read");

  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (!startupId) return;
      event.preventDefault();
      if (window.matchMedia("(min-width: 768px)").matches) {
        setOpen(true);
        desktopInputRef.current?.focus();
      } else {
        setMobileOpen(true);
        requestAnimationFrame(() => mobileInputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startupId]);

  const searching = Boolean(startupId) && (open || mobileOpen) && debounced.length > 0;
  const documentSectionQuery = DOCUMENT_SECTION_QUERY.test(debounced);
  const investorSectionQuery = INVESTOR_SECTION_QUERY.test(debounced);

  const [investorsQuery, documentsQuery] = useQueries({
    queries: [
      {
        queryKey: ["global-search", "investors", startupId, debounced, investorSectionQuery] as const,
        queryFn: () =>
          listInvestors(startupId!, {
            page: 1,
            limit: RESULT_LIMIT,
            // "investors" / "contacts" should list recent contacts, not filter by that word.
            ...(investorSectionQuery ? {} : { search: debounced }),
          }),
        enabled: searching && canInvestors && !documentSectionQuery,
      },
      {
        queryKey: ["global-search", "documents", startupId, debounced, documentSectionQuery] as const,
        queryFn: () =>
          listDocuments(startupId!, {
            page: 1,
            limit: RESULT_LIMIT,
            // "document" / "docs" should list recent vault files, not filter by that word.
            ...(documentSectionQuery ? {} : { search: debounced }),
          }),
        enabled: searching && canDocuments && !investorSectionQuery,
      },
    ],
  });

  const hits = useMemo(() => {
    const next: SearchHit[] = [];

    // No "Pages" shortcuts here — they stole Enter (index 0) so every search for
    // "document" felt like it always opened the same first vault file.

    if (canInvestors) {
      for (const row of investorsQuery.data?.data ?? []) {
        const firm = row.ventureFirm?.trim();
        const typeLabel = row.investorType
          ? INVESTOR_TYPE_LABELS[row.investorType as InvestorType]
          : null;
        next.push({
          kind: "investor",
          id: row.id,
          title: row.fullName,
          subtitle: [firm, typeLabel, row.email].filter(Boolean).join(" · ") || "Investor",
          href: `/investors?investor=${row.id}`,
        });
      }
    }

    if (canDocuments) {
      for (const row of documentsQuery.data?.data ?? []) {
        next.push({
          kind: "document",
          id: row.id,
          title: row.title,
          subtitle:
            TYPE_LABELS[row.documentType] ??
            row.currentVersion?.originalFilename ??
            "Document",
          href: `/documents?document=${encodeURIComponent(row.id)}`,
        });
      }
    }

    return next;
  }, [
    canDocuments,
    canInvestors,
    documentsQuery.data?.data,
    investorsQuery.data?.data,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  useEffect(() => {
    setActiveIndex((index) => (hits.length === 0 ? 0 : Math.min(index, hits.length - 1)));
  }, [hits.length]);

  const isFetching =
    (canInvestors && investorsQuery.isFetching) || (canDocuments && documentsQuery.isFetching);

  const investorHits = hits.filter((hit) => hit.kind === "investor");
  const documentHits = hits.filter((hit) => hit.kind === "document");

  function resetQuery() {
    setQuery("");
    setDebounced("");
    setActiveIndex(0);
  }

  function closeAll() {
    setOpen(false);
    setMobileOpen(false);
    resetQuery();
  }

  function goTo(hit: SearchHit) {
    closeAll();
    navigate(hit.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) {
        resetQuery();
      } else {
        closeAll();
        desktopInputRef.current?.blur();
        mobileInputRef.current?.blur();
      }
      return;
    }

    if (!hits.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % hits.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + hits.length) % hits.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[activeIndex];
      if (hit) goTo(hit);
    }
  }

  const resultsPanel = (
    <div
      id={listId}
      role="listbox"
      aria-label="Search results"
      className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-lg"
    >
      {debounced.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Search investors and documents in this workspace.
        </p>
      ) : isFetching && hits.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching…
        </div>
      ) : hits.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No matches for “{debounced}”
        </p>
      ) : (
        <div className="scrollbar-slim max-h-[min(28rem,70vh)] overflow-y-auto py-1">
          {investorHits.length > 0 && (
            <ResultSection
              label="Investors"
              icon={Users}
              hits={investorHits}
              activeId={hits[activeIndex]?.id ?? null}
              offset={0}
              onSelect={goTo}
              onHover={setActiveIndex}
            />
          )}
          {documentHits.length > 0 && (
            <ResultSection
              label="Documents"
              icon={FileText}
              hits={documentHits}
              activeId={hits[activeIndex]?.id ?? null}
              offset={investorHits.length}
              onSelect={goTo}
              onHover={setActiveIndex}
            />
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="relative hidden max-w-md flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={desktopInputRef}
          value={query}
          disabled={!startupId}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onInputKeyDown}
          placeholder={startupId ? "Search investors, documents…" : "Select a workspace to search"}
          aria-label="Search investors and documents"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-expanded={open && query.length > 0}
          className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          autoComplete="off"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline-block">
          ⌘K
        </kbd>
        {open && query.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50">{resultsPanel}</div>
        )}
      </div>

      <div className="relative md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Search"
          aria-expanded={mobileOpen}
          disabled={!startupId}
          onClick={() => {
            setMobileOpen(true);
            requestAnimationFrame(() => mobileInputRef.current?.focus());
          }}
        >
          <Search className="h-4 w-4" />
        </Button>

        {mobileOpen && (
          <>
            <button
              type="button"
              aria-label="Close search"
              className="fixed inset-0 z-40 bg-background/40 backdrop-blur-[1px]"
              onClick={closeAll}
            />
            <div className="fixed inset-x-3 top-3 z-50 space-y-2 rounded-xl border border-border/70 bg-card p-2 shadow-lg">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={mobileInputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search investors, documents…"
                  aria-label="Search investors and documents"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  className="h-10 w-full rounded-lg border border-border/70 bg-surface pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-ring"
                  autoComplete="off"
                />
                <button
                  type="button"
                  aria-label="Close search"
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  onClick={closeAll}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {resultsPanel}
            </div>
          </>
        )}
      </div>
    </>
  );
}

type ResultSectionProps = {
  label: string;
  icon: typeof Users;
  hits: SearchHit[];
  activeId: string | null;
  offset: number;
  onSelect: (hit: SearchHit) => void;
  onHover: (index: number) => void;
};

function ResultSection({
  label,
  icon: Icon,
  hits,
  activeId,
  offset,
  onSelect,
  onHover,
}: ResultSectionProps) {
  return (
    <section className="py-1">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <ul>
        {hits.map((hit, index) => {
          const active = hit.id === activeId;
          return (
            <li key={`${hit.kind}-${hit.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(hit);
                }}
                onMouseEnter={() => onHover(offset + index)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                  active ? "bg-primary/10" : "hover:bg-surface/60",
                )}
              >
                {hit.kind === "investor" ? (
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-xs font-semibold text-primary">
                    {getInitials(hit.title)}
                  </div>
                ) : (
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface text-muted-foreground">
                    <FileText className="h-4 w-4" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{hit.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{hit.subtitle}</div>
                </div>
                <span className="shrink-0 rounded-md border border-border/60 bg-surface/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {hit.kind === "investor" ? "Investor" : "Doc"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
