import { Check, FileText, Sparkles } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
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

type DocumentsTableProps = {
  documents: VaultDocument[];
  selectedIds: Set<string> | null;
  focusedDocumentId?: string | null;
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

export function DocumentsTable({
  documents,
  selectedIds,
  focusedDocumentId = null,
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
}: DocumentsTableProps) {
  const selectionActive = selectedIds !== null;

  return (
    <div className="scrollbar-slim overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface/60 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Document</th>
            <th scope="col" className="px-4 py-3 font-medium">Type</th>
            <th scope="col" className="px-4 py-3 font-medium">Version</th>
            <th scope="col" className="px-4 py-3 font-medium">Size</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 font-medium">AI score</th>
            <th scope="col" className="px-4 py-3 font-medium">Updated</th>
            <th scope="col" className="w-12 px-4 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {documents.map((doc) => {
            const version = doc.currentVersion;
            const status = statusOf(version);
            const selected = selectedIds?.has(doc.id) ?? false;
            const focused = focusedDocumentId === doc.id;

            return (
              <tr
                key={doc.id}
                data-document-id={doc.id}
                aria-selected={selectionActive ? selected : undefined}
                onClick={selectionActive ? () => onToggleOne(doc.id) : undefined}
                className={cn(
                  "transition-colors",
                  selectionActive ? "cursor-pointer hover:bg-surface-hover/50" : "hover:bg-surface-hover/50",
                  selected && "bg-primary/6",
                  focused && "bg-primary/10 ring-1 ring-inset ring-primary/40",
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors",
                        selected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                      )}
                    >
                      {selected ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{doc.title}</div>
                      {version?.processingError && (
                        <div className="truncate text-xs text-destructive">{version.processingError}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {TYPE_LABELS[doc.documentType] ?? doc.documentType}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {version ? `v${version.versionNumber}` : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatFileSize(version?.fileSize)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <DocumentStatusBadge status={status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    {doc.aiScore != null ? (
                      <Badge className={cn(scoreColor(doc.aiScore), "border-0")}>{doc.aiScore}</Badge>
                    ) : (
                      <Badge className="border-0 bg-muted text-muted-foreground">—</Badge>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatDate(doc.updatedAt)}
                </td>
                <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                  <DocumentActions
                    document={doc}
                    canOpen={status === "ready"}
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
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
