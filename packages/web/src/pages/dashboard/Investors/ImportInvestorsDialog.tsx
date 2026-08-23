import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { apiErrorMessage } from "../../../lib/api-error";
import { runWithConcurrency } from "../../../lib/concurrency";
import { parseCsv } from "../../../lib/csv";
import { createInvestor, INVESTOR_TYPES, type InvestorInput, type InvestorType } from "../../../lib/investor-api";

const HEADER_ALIASES: Record<string, keyof InvestorInput> = {
  fullname: "fullName",
  name: "fullName",
  email: "email",
  emailaddress: "email",
  venturefirm: "ventureFirm",
  firm: "ventureFirm",
  fund: "ventureFirm",
  investortype: "investorType",
  type: "investorType",
  sectorfocus: "sectorFocus",
  sector: "sectorFocus",
  investmentstagepreference: "investmentStagePreference",
  stagepreference: "investmentStagePreference",
  stage: "investmentStagePreference",
  linkedinurl: "linkedinUrl",
  linkedin: "linkedinUrl",
  notes: "notes",
  source: "source",
};

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const URL_RE = /^https?:\/\/\S+\.\S+/i;
const MAX_ROWS = 500;

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z]/g, "");
}

type ParsedRow = { line: number; input: InvestorInput };
type SkippedRow = { line: number; label: string; reason: string };

function buildRows(text: string): { rows: ParsedRow[]; skipped: SkippedRow[]; truncated: boolean } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], skipped: [], truncated: false };

  const headerMap = table[0].map((cell) => HEADER_ALIASES[normalizeHeader(cell)] ?? null);
  if (!headerMap.includes("fullName")) {
    return {
      rows: [],
      skipped: [{ line: 1, label: "Header row", reason: "No \"name\"/\"fullName\" column found" }],
      truncated: false,
    };
  }

  const body = table.slice(1);
  const truncated = body.length > MAX_ROWS;
  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];

  body.slice(0, MAX_ROWS).forEach((cells, index) => {
    const line = index + 2; // account for the header row, 1-indexed
    const raw: Record<string, string> = {};
    headerMap.forEach((field, col) => {
      if (field) raw[field] = (cells[col] ?? "").trim();
    });

    const label = raw.fullName || `Row ${line}`;
    const errors: string[] = [];

    if (!raw.fullName || raw.fullName.length < 2) {
      errors.push("name must be at least 2 characters");
    } else if (raw.fullName.length > 150) {
      errors.push("name must be at most 150 characters");
    }

    if (raw.email && !EMAIL_RE.test(raw.email)) errors.push("invalid email");
    if (raw.linkedinUrl && !URL_RE.test(raw.linkedinUrl)) {
      errors.push("LinkedIn URL must start with http:// or https://");
    }

    let investorType: InvestorType | null = null;
    if (raw.investorType) {
      const match = INVESTOR_TYPES.find(
        (t) => t.toLowerCase() === raw.investorType!.toLowerCase().replace(/\s+/g, "_"),
      );
      if (!match) errors.push(`unknown investor type "${raw.investorType}"`);
      else investorType = match;
    }

    const tooLong: [string, string, number][] = [
      ["ventureFirm", "firm", 150],
      ["sectorFocus", "sector focus", 200],
      ["investmentStagePreference", "stage preference", 200],
      ["source", "source", 100],
      ["notes", "notes", 2000],
    ];
    for (const [field, label2, max] of tooLong) {
      const value = raw[field];
      if (value && value.length > max) errors.push(`${label2} must be at most ${max} characters`);
    }

    if (errors.length > 0) {
      skipped.push({ line, label, reason: errors.join("; ") });
      return;
    }

    rows.push({
      line,
      input: {
        fullName: raw.fullName,
        email: raw.email || null,
        ventureFirm: raw.ventureFirm || null,
        investorType,
        sectorFocus: raw.sectorFocus || null,
        investmentStagePreference: raw.investmentStagePreference || null,
        linkedinUrl: raw.linkedinUrl || null,
        notes: raw.notes || null,
        source: raw.source || null,
      },
    });
  });

  return { rows, skipped, truncated };
}

type ImportInvestorsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startupId: string;
  onImported: () => void;
};

type Outcome = { succeeded: number; failed: { label: string; reason: string }[] };

export function ImportInvestorsDialog({
  open,
  onOpenChange,
  startupId,
  onImported,
}: ImportInvestorsDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ rows: ParsedRow[]; skipped: SkippedRow[]; truncated: boolean } | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function reset() {
    setFileName(null);
    setParsed(null);
    setOutcome(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setOutcome(null);
    const reader = new FileReader();
    reader.onload = () => setParsed(buildRows(String(reader.result ?? "")));
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!parsed || parsed.rows.length === 0) return;
    setImporting(true);

    const settled = await runWithConcurrency(parsed.rows, 5, (row) =>
      createInvestor(startupId, row.input),
    );

    const failed: { label: string; reason: string }[] = [];
    let succeeded = 0;
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") succeeded += 1;
      else {
        failed.push({
          label: parsed.rows[index].input.fullName,
          reason: apiErrorMessage(result.reason, "Could not import this row"),
        });
      }
    });

    setImporting(false);
    setOutcome({ succeeded, failed });
    if (succeeded > 0) onImported();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0 sm:p-0">
        <DialogHeader className="border-b border-border/70 bg-surface/40 px-6 py-5">
          <div className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <DialogTitle>Import investors from CSV</DialogTitle>
          <DialogDescription>
            Add your investor list in one step. We’ll validate every row before importing it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="group h-auto min-h-40 w-full flex-col justify-center gap-3 rounded-xl border-2 border-dashed border-border/80 bg-surface/30 px-5 py-7 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.045] focus-visible:border-primary/60"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-border/70 bg-card text-muted-foreground shadow-xs transition-colors group-hover:border-primary/30 group-hover:text-primary">
              <Upload className="h-5 w-5" />
            </span>
            <span className="min-w-0 max-w-full">
              <span className="block truncate font-medium text-foreground">
                {fileName ?? "Choose a CSV file"}
              </span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {fileName ? "Click or drop another file to replace it" : "Click to browse or drag and drop"}
              </span>
            </span>
          </Button>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-md border border-border/60 bg-surface/60 px-2 py-1">CSV only</span>
            <span className="rounded-md border border-border/60 bg-surface/60 px-2 py-1">Up to {MAX_ROWS} rows</span>
            <span>Name column required</span>
          </div>

          {parsed && !outcome && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-surface/40 p-3.5 text-sm">
              <p className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                <span>
                  <span className="font-medium text-foreground">{parsed.rows.length}</span>{" "}
                  {parsed.rows.length === 1 ? "investor" : "investors"} ready
                  {parsed.skipped.length > 0 && ` · ${parsed.skipped.length} skipped`}
                </span>
              </p>
              {parsed.truncated && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Only the first {MAX_ROWS} data rows are imported per file.
                </p>
              )}
              {parsed.skipped.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Line {parsed.skipped[0].line}: {parsed.skipped[0].reason}
                  {parsed.skipped.length > 1 && ` (and ${parsed.skipped.length - 1} more)`}
                </p>
              )}
            </div>
          )}

          {outcome && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-surface/40 p-3.5 text-sm">
              <p className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                <span>
                  <span className="font-medium text-foreground">{outcome.succeeded}</span> imported
                  {outcome.failed.length > 0 && ` · ${outcome.failed.length} failed`}
                </span>
              </p>
              {outcome.failed.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {outcome.failed[0].label}: {outcome.failed[0].reason}
                  {outcome.failed.length > 1 && ` (and ${outcome.failed.length - 1} more)`}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border/70 bg-surface/20 px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            {outcome ? "Close" : "Cancel"}
          </Button>
          {!outcome && (
            <Button
              type="button"
              disabled={!parsed || parsed.rows.length === 0 || importing}
              onClick={() => void handleImport()}
            >
              {importing
                ? <><Loader2 className="h-4 w-4 animate-spin" />Importing…</>
                : `Import${parsed ? ` ${parsed.rows.length}` : ""} investor${parsed?.rows.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
