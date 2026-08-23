import type { SelectOption } from "../../../components/ui/select";
import type { DocumentType, DocumentVersion } from "../../../lib/document-api";

export const DOCUMENT_TYPES: DocumentType[] = [
  "pitch_deck",
  "financial_model",
  "cap_table",
  "term_sheet",
  "data_room",
  "other",
];

export const TYPE_LABELS: Record<string, string> = {
  pitch_deck: "Pitch deck",
  financial_model: "Financial model",
  cap_table: "Cap table",
  term_sheet: "Term sheet",
  data_room: "Data room",
  other: "Other",
};

export const TYPE_OPTIONS: SelectOption[] = DOCUMENT_TYPES.map((value) => ({
  value,
  label: TYPE_LABELS[value],
}));

export type ProcessingStatus = DocumentVersion["processingStatus"];

export const STATUS_LABELS: Record<string, string> = {
  ready: "Ready",
  processing: "Processing",
  pending_upload: "Uploading",
  failed: "Failed",
};

export const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: "ready", label: "Ready" },
  { value: "processing", label: "Processing" },
  { value: "pending_upload", label: "Uploading" },
  { value: "failed", label: "Failed" },
];

export const LIFECYCLE_FILTER_OPTIONS: SelectOption[] = [
  { value: "active", label: "Active documents" },
  { value: "archived", label: "Archived documents" },
];

export function statusOf(version: DocumentVersion | null | undefined): ProcessingStatus {
  if (!version || version.processingStatus === "pending_upload") return "pending_upload";
  if (version.processingStatus === "failed" || version.renderStatus === "failed") return "failed";
  if (
    version.processingStatus !== "ready" ||
    version.renderStatus === "pending" ||
    version.renderStatus === "rendering"
  ) {
    return "processing";
  }
  return "ready";
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function guessDocumentType(filename: string): DocumentType {
  const lower = filename.toLowerCase();
  if (lower.includes("deck") || lower.includes("pitch")) return "pitch_deck";
  if (lower.includes("cap")) return "cap_table";
  if (lower.includes("term")) return "term_sheet";
  if (lower.includes("model") || lower.includes("financial")) return "financial_model";
  return "other";
}

export const UPLOAD_ACCEPT =
  ".pdf,.docx,.xlsx,.pptx,.txt,application/pdf,text/plain," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const UNSUPPORTED_TYPE_MESSAGE = "Unsupported file type. Allowed: PDF, DOCX, XLSX, PPTX, TXT";

export function guessMimeType(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
