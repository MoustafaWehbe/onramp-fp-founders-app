import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../../../components/shared/EmptyState";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { apiErrorMessage } from "../../../lib/api-error";
import {
  confirmDocumentVersion,
  createDocumentUploadSession,
  createVersionUploadSession,
  deleteDocument,
  getDocumentFileAccess,
  listDocuments,
  uploadToSignedUrl,
  type DocumentType,
  type VaultDocument,
} from "../../../lib/document-api";
import { cn, formatDate } from "../../../lib/utils";

const TYPE_LABELS: Record<string, string> = {
  pitch_deck: "Pitch deck",
  financial_model: "Financial model",
  cap_table: "Cap table",
  term_sheet: "Term sheet",
  data_room: "Data room",
  other: "Other",
};

function scoreColor(score: number) {
  if (score >= 80) return "bg-success/15 text-success";
  if (score >= 65) return "bg-warning/20 text-warning";
  return "bg-destructive/15 text-destructive";
}

function formatSize(bytes: number | null | undefined) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function guessDocumentType(filename: string): DocumentType {
  const lower = filename.toLowerCase();
  if (lower.includes("deck") || lower.includes("pitch")) return "pitch_deck";
  if (lower.includes("cap")) return "cap_table";
  if (lower.includes("term")) return "term_sheet";
  if (lower.includes("model") || lower.includes("financial")) return "financial_model";
  return "other";
}

const UPLOAD_ACCEPT =
  ".pdf,.docx,.xlsx,.pptx,.txt,application/pdf,text/plain," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const UNSUPPORTED_TYPE_MESSAGE = "Unsupported file type. Allowed: PDF, DOCX, XLSX, PPTX, TXT";

function guessMimeType(file: File): string {
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

export function Documents() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);
  const [versionTargetId, setVersionTargetId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  const docsQuery = useQuery({
    queryKey: ["documents", startupId, search, typeFilter],
    queryFn: () =>
      listDocuments(startupId, {
        page: 1,
        limit: 100,
        search: search.trim() || undefined,
        documentType: typeFilter || undefined,
      }),
    refetchInterval: (query) => {
      const rows = query.state.data?.data ?? [];
      const busy = rows.some((row) => {
        const status = row.currentVersion?.processingStatus;
        return status === "processing" || status === "pending_upload";
      });
      return busy ? 3000 : false;
    },
  });

  const rows = docsQuery.data?.data ?? [];
  const canUpload = can("documents", "create");
  const canUpdate = can("documents", "update");
  const canDelete = can("documents", "delete");

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const mimeType = guessMimeType(file);
      if (mimeType === "application/octet-stream") {
        throw new Error(UNSUPPORTED_TYPE_MESSAGE);
      }
      const session = await createDocumentUploadSession(startupId, {
        title: file.name.replace(/\.[^.]+$/, "") || file.name,
        documentType: guessDocumentType(file.name),
        originalFilename: file.name,
        mimeType,
        fileSize: file.size,
      });
      try {
        await uploadToSignedUrl(session.upload.uploadUrl, file, session.upload.headers);
        await confirmDocumentVersion(startupId, session.document.id, session.upload.versionId);
      } catch (error) {
        // The document row was already created for this upload session. If the
        // bytes never made it to storage or confirm failed, remove it rather than
        // leaving a phantom "Uploading…" card that can never finish.
        await deleteDocument(startupId, session.document.id).catch(() => {});
        throw error;
      }
      return session.document;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents", startupId] });
      toast.success("Document uploaded — processing started");
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ["documents", startupId] });
      toast.error(apiErrorMessage(error, "Upload failed"));
    },
  });

  const versionMutation = useMutation({
    mutationFn: async ({ documentId, file }: { documentId: string; file: File }) => {
      const mimeType = guessMimeType(file);
      if (mimeType === "application/octet-stream") {
        throw new Error(UNSUPPORTED_TYPE_MESSAGE);
      }
      const session = await createVersionUploadSession(startupId, documentId, {
        originalFilename: file.name,
        mimeType,
        fileSize: file.size,
      });
      await uploadToSignedUrl(session.upload.uploadUrl, file, session.upload.headers);
      await confirmDocumentVersion(startupId, documentId, session.upload.versionId);
    },
    onSuccess: () => {
      setVersionTargetId(null);
      void queryClient.invalidateQueries({ queryKey: ["documents", startupId] });
      toast.success("New version uploaded — processing started");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Version upload failed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => deleteDocument(startupId, documentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents", startupId] });
      toast.success("Document deleted");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not delete document")),
  });

  const openFile = async (doc: VaultDocument, disposition: "preview" | "download") => {
    // Open the tab synchronously so the browser does not treat it as a blocked popup
    // after the async file-access round-trip.
    const previewTab =
      disposition === "preview" ? window.open("about:blank", "_blank") : null;

    try {
      const access = await getDocumentFileAccess(startupId, doc.id, doc.currentVersion?.id);
      const fileRes = await fetch(access.url);
      if (!fileRes.ok) {
        throw new Error(`Could not fetch file (${fileRes.status})`);
      }
      const blob = await fileRes.blob();
      const typed = new Blob([blob], {
        type: access.mimeType || blob.type || "application/octet-stream",
      });
      const objectUrl = URL.createObjectURL(typed);

      if (disposition === "download") {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = access.originalFilename || `${doc.title}.bin`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      } else if (previewTab) {
        previewTab.location.href = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } else {
        window.open(objectUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } catch (error) {
      previewTab?.close();
      toast.error(apiErrorMessage(error, "Could not open file"));
    }
  };

  const typeOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.documentType))).sort(),
    [rows],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data room"
        description="Versioned documents, indexed for AI search and reviewer access."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={UPLOAD_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) uploadMutation.mutate(file);
              }}
            />
            <input
              ref={versionInputRef}
              type="file"
              className="hidden"
              accept={UPLOAD_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                const documentId = versionTargetId;
                event.target.value = "";
                if (file && documentId) versionMutation.mutate({ documentId, file });
              }}
            />
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary-hover"
              disabled={!canUpload || uploadMutation.isPending || versionMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {uploadMutation.isPending ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search documents…"
            className="h-9 border-border bg-surface pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="">Type</option>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type] ?? type}
            </option>
          ))}
        </select>
      </div>

      {docsQuery.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-44 w-full" />
          ))}
        </div>
      ) : docsQuery.isError ? (
        <div className="card-elevated">
          <EmptyState
            icon={FileText}
            title="Could not load documents"
            description={apiErrorMessage(docsQuery.error, "Please try again.")}
            action={<Button onClick={() => void docsQuery.refetch()}>Retry</Button>}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="card-elevated">
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Upload a PDF, DOCX, XLSX, PPTX, or TXT file to start your data room."
            action={
              canUpload ? (
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-1.5 h-4 w-4" /> Upload
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((doc) => {
            const version = doc.currentVersion;
            const status = version?.processingStatus ?? "pending_upload";
            return (
              <div
                key={doc.id}
                className="card-elevated group p-4 transition-colors hover:border-primary/40"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{doc.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {TYPE_LABELS[doc.documentType] ?? doc.documentType}
                        {version ? ` · v${version.versionNumber} · ${formatSize(version.fileSize)}` : ""}
                      </div>
                    </div>
                  </div>
                  {canDelete && (
                    <button
                      type="button"
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete “${doc.title}”?`)) {
                          deleteMutation.mutate(doc.id);
                        }
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span className="font-medium">AI score</span>
                    {doc.aiScore != null ? (
                      <Badge className={cn(scoreColor(doc.aiScore), "border-0")}>{doc.aiScore}</Badge>
                    ) : (
                      <Badge className="border-0 bg-muted text-muted-foreground">—</Badge>
                    )}
                  </div>
                  <span className="text-muted-foreground">
                    {status === "ready"
                      ? formatDate(doc.updatedAt)
                      : status === "failed"
                        ? "Failed"
                        : status === "processing"
                          ? "Processing…"
                          : "Uploading…"}
                  </span>
                </div>

                {version?.processingError && (
                  <p className="mt-2 line-clamp-2 text-xs text-destructive">{version.processingError}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 flex-1"
                    disabled={status !== "ready"}
                    onClick={() => void openFile(doc, "preview")}
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" /> Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 flex-1"
                    disabled={status !== "ready"}
                    onClick={() => void openFile(doc, "download")}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Download
                  </Button>
                  {canUpdate && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-full"
                      disabled={versionMutation.isPending || status === "pending_upload"}
                      onClick={() => {
                        setVersionTargetId(doc.id);
                        versionInputRef.current?.click();
                      }}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      {versionMutation.isPending && versionTargetId === doc.id
                        ? "Uploading…"
                        : "Upload new version"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
