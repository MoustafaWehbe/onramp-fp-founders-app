import { Check, Download, Eye, FileText, Sparkles, Upload } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import type { VaultDocument } from "../../../lib/document-api";
import { cn, formatDate } from "../../../lib/utils";
import { DocumentActions } from "./DocumentActions";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { TYPE_LABELS, formatFileSize, statusOf } from "./document-types";

function scoreColor(score: number) {
  if (score >= 80) return "bg-success/15 text-success";
  if (score >= 65) return "bg-warning/20 text-warning";
  return "bg-destructive/15 text-destructive";
}

type DocumentsCardListProps = {
  documents: VaultDocument[];
  selectedIds: Set<string> | null;
  onToggleOne: (id: string) => void;
  canUpdate: boolean;
  canDelete: boolean;
  uploadingVersionId: string | null;
  onPreview: (doc: VaultDocument) => void;
  onDownload: (doc: VaultDocument) => void;
  onUploadVersion: (doc: VaultDocument) => void;
  onEdit: (doc: VaultDocument) => void;
  onViewVersions: (doc: VaultDocument) => void;
  onViewAnalytics: (doc: VaultDocument) => void;
  onDelete: (doc: VaultDocument) => void;
};

export function DocumentsCardList({
  documents,
  selectedIds,
  onToggleOne,
  canUpdate,
  canDelete,
  uploadingVersionId,
  onPreview,
  onDownload,
  onUploadVersion,
  onEdit,
  onViewVersions,
  onViewAnalytics,
  onDelete,
}: DocumentsCardListProps) {
  const selectionActive = selectedIds !== null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {documents.map((doc) => {
        const version = doc.currentVersion;
        const status = statusOf(version);
        const selected = selectedIds?.has(doc.id) ?? false;
        const canOpen = status === "ready";

        return (
          <div
            key={doc.id}
            aria-selected={selectionActive ? selected : undefined}
            onClick={selectionActive ? () => onToggleOne(doc.id) : undefined}
            className={cn(
              "card-elevated group p-4 transition-colors",
              selectionActive ? "cursor-pointer" : "hover:border-primary/40",
              selected && "border-primary/50 bg-primary/[0.04]",
            )}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                {/* Doubles as the selection indicator, same convention as the
                    investor list: a filled circle with a check rather than a
                    separate checkbox competing for space on a small tile. */}
                <div
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-md transition-colors",
                    selected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                  )}
                >
                  {selected ? <Check className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{doc.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {TYPE_LABELS[doc.documentType] ?? doc.documentType}
                    {version ? ` · v${version.versionNumber} · ${formatFileSize(version.fileSize)}` : ""}
                  </div>
                </div>
              </div>
              <div onClick={(event) => event.stopPropagation()}>
                <DocumentActions
                  document={doc}
                  canOpen={canOpen}
                  canUpdate={canUpdate}
                  canDelete={canDelete}
                  uploadingVersion={uploadingVersionId === doc.id}
                  onPreview={onPreview}
                  onDownload={onDownload}
                  onUploadVersion={onUploadVersion}
                  onEdit={onEdit}
                  onViewVersions={onViewVersions}
                  onViewAnalytics={onViewAnalytics}
                  onDelete={onDelete}
                  includeQuickActions={false}
                />
              </div>
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
              {status === "ready" ? (
                <span className="text-muted-foreground">{formatDate(doc.updatedAt)}</span>
              ) : (
                <DocumentStatusBadge status={status} />
              )}
            </div>

            {version?.processingError && (
              <p className="mt-2 line-clamp-2 text-xs text-destructive">{version.processingError}</p>
            )}

            <div
              className="mt-3 flex flex-wrap gap-1.5"
              onClick={(event) => selectionActive && event.stopPropagation()}
            >
              <Button
                size="sm"
                variant="ghost"
                className="h-8 flex-1"
                disabled={!canOpen}
                onClick={() => onPreview(doc)}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" /> Preview
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 flex-1"
                disabled={!canOpen}
                onClick={() => onDownload(doc)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download
              </Button>
              {canUpdate && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full"
                  disabled={uploadingVersionId === doc.id || status === "pending_upload"}
                  onClick={() => onUploadVersion(doc)}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {uploadingVersionId === doc.id ? "Uploading…" : "Upload new version"}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
