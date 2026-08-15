import { useRef, useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";
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
import { cn } from "../../../lib/utils";

const COLUMN_GUIDE: { label: string; required?: boolean; example: string }[] = [
  { label: "name", required: true, example: "Ada Lovelace" },
  { label: "email", example: "ada@fund.com" },
  { label: "firm", example: "Analytical Ventures" },
  { label: "type", example: "vc" },
  { label: "sector", example: "Fintech" },
  { label: "stage", example: "Seed" },
  { label: "linkedin", example: "https://linkedin.com/in/ada" },
  { label: "source", example: "Conference" },
  { label: "notes", example: "" },
];

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import investors from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV of investor contacts columns are matched automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 rounded-lg border border-border/70 bg-surface/40 p-3">
            <div className="flex flex-wrap gap-1.5">
              {COLUMN_GUIDE.map((col) => (
                <span
                  key={col.label}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium",
                    col.required ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {col.label}
                  {col.required && " *"}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Only <span className="font-medium text-foreground">name</span> is required column
              order doesn't matter, and unrecognized columns are ignored. Valid types:{" "}
              {INVESTOR_TYPES.join(", ")}.
            </p>

            <div className="scrollbar-slim mt-3 min-w-0 overflow-x-auto rounded-md border border-border/60">
              <table className="min-w-full text-left font-mono text-[11px]">
                <thead className="bg-surface/70 text-muted-foreground">
                  <tr>
                    {COLUMN_GUIDE.map((col) => (
                      <th key={col.label} className="whitespace-nowrap px-2 py-1 font-medium">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-foreground/80">
                    {COLUMN_GUIDE.map((col) => (
                      <td key={col.label} className="whitespace-nowrap px-2 py-1">
                        {col.example || "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

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
            className="w-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {fileName ?? "Choose a CSV file"}
          </Button>

          {parsed && !outcome && (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium text-foreground">{parsed.rows.length}</span> ready to
                import
                {parsed.skipped.length > 0 && (
                  <>
                    , <span className="font-medium text-destructive">{parsed.skipped.length}</span>{" "}
                    skipped
                  </>
                )}
              </p>
              {parsed.truncated && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Only the first {MAX_ROWS} data rows are imported per file.
                </p>
              )}
              {parsed.skipped.length > 0 && (
                <div className="scrollbar-slim max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border/70 bg-surface/50 p-2 text-xs">
                  {parsed.skipped.map((row) => (
                    <div key={row.line}>
                      <span className="font-medium text-foreground">
                        Line {row.line} ({row.label}):
                      </span>{" "}
                      <span className="text-muted-foreground">{row.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {outcome && (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium text-foreground">{outcome.succeeded}</span> imported
                {outcome.failed.length > 0 && (
                  <>
                    , <span className="font-medium text-destructive">{outcome.failed.length}</span>{" "}
                    failed
                  </>
                )}
              </p>
              {outcome.failed.length > 0 && (
                <div className="scrollbar-slim max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border/70 bg-surface/50 p-2 text-xs">
                  {outcome.failed.map((row, index) => (
                    <div key={index}>
                      <span className="font-medium text-foreground">{row.label}:</span>{" "}
                      <span className="text-muted-foreground">{row.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {outcome ? "Close" : "Cancel"}
          </Button>
          {!outcome && (
            <Button
              type="button"
              disabled={!parsed || parsed.rows.length === 0 || importing}
              onClick={() => void handleImport()}
            >
              {importing
                ? "Importing…"
                : `Import${parsed ? ` ${parsed.rows.length}` : ""} investor${parsed?.rows.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
