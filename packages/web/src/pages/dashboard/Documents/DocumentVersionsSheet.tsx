import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileText, RotateCcw, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { Skeleton } from "../../../components/ui/skeleton";
import { apiErrorMessage } from "../../../lib/api-error";
import {
  getDocument,
  promoteDocumentVersion,
  retryDocumentVersion,
  type DocumentVersion,
} from "../../../lib/document-api";
import { cn, formatDate } from "../../../lib/utils";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { formatFileSize, statusOf } from "./document-types";

type DocumentVersionsSheetProps = {
  startupId: string;
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
  onPreview: (version: DocumentVersion) => void;
  onDownload: (version: DocumentVersion) => void;
  canUpdate: boolean;
  focusedVersionId?: string | null;
};

/**
 * Every prior version stays in storage and in the database — GET
 * .../documents/:id has always returned the full list, but nothing in the
 * app called it, so uploading a new version made every earlier one
 * permanently unreachable from the UI even though it was never actually gone.
 */
export function DocumentVersionsSheet({
  startupId,
  documentId,
  onOpenChange,
  onPreview,
  onDownload,
  canUpdate,
  focusedVersionId = null,
}: DocumentVersionsSheetProps) {
  const open = documentId !== null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["documents", startupId, "detail", documentId],
    queryFn: () => getDocument(startupId, documentId as string),
    enabled: open,
  });

  // Never show a previous document while the next id is loading — that made
  // every search selection look like "Northbeam Product Teaser".
  const doc = query.data?.id === documentId ? query.data : undefined;
  const showLoading = open && (query.isPending || query.isFetching) && !doc;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["documents", startupId, "detail", documentId] }),
      queryClient.invalidateQueries({ queryKey: ["documents", startupId] }),
    ]);
  };

  const retryMutation = useMutation({
    mutationFn: (versionId: string) =>
      retryDocumentVersion(startupId, documentId as string, versionId),
    onSuccess: async () => {
      await refresh();
      toast.success("Document processing restarted");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not retry processing")),
  });

  const promoteMutation = useMutation({
    mutationFn: (versionId: string) =>
      promoteDocumentVersion(startupId, documentId as string, versionId),
    onSuccess: async () => {
      await refresh();
      toast.success("Current version updated");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not make version current")),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent key={documentId ?? "closed"}>
        <SheetHeader>
          <SheetTitle>Version history</SheetTitle>
          <SheetDescription>
            {doc ? doc.title : "Every uploaded version of this document."}
          </SheetDescription>
        </SheetHeader>

        {showLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="text-sm text-destructive">
            {apiErrorMessage(query.error, "Could not load version history.")}
          </p>
        ) : (
          <ul className="space-y-2">
            {doc?.versions.map((version) => {
              const status = statusOf(version);
              const canOpen = status === "ready";
              const canPromote =
                canUpdate &&
                !doc?.archivedAt &&
                !version.isCurrent &&
                version.processingStatus === "ready" &&
                ["ready", "unsupported"].includes(version.renderStatus);
              const canRetry =
                canUpdate &&
                !doc?.archivedAt &&
                (version.processingStatus === "failed" || version.renderStatus === "failed");
              return (
                <li
                  key={version.id}
                  className={cn(
                    "rounded-lg border border-border p-3",
                    version.isCurrent && "border-primary/40 bg-primary/4",
                    focusedVersionId === version.id && "ring-2 ring-primary/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">
                            {version.originalFilename || `Version ${version.versionNumber}`}
                          </span>
                          {version.isCurrent && (
                            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Current
                            </span>
                          )}
                          {focusedVersionId === version.id && !version.isCurrent && (
                            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Reviewed version
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          Version {version.versionNumber}
                          {" · "}
                          {version.uploaderName ?? "Unknown uploader"} · {formatDate(version.createdAt)} ·{" "}
                          {formatFileSize(version.fileSize)}
                        </div>
                      </div>
                    </div>
                    <DocumentStatusBadge status={status} />
                  </div>

                  {(version.processingError || version.renderError) && (
                    <p className="mt-2 line-clamp-2 text-xs text-destructive">
                      {version.processingError || version.renderError}
                    </p>
                  )}

                  <div className="mt-2.5 flex gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 flex-1 text-xs"
                      disabled={!canOpen}
                      onClick={() => onPreview(version)}
                    >
                      <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 flex-1 text-xs"
                      disabled={!canOpen}
                      onClick={() => onDownload(version)}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" /> Download
                    </Button>
                  </div>
                  {(canRetry || canPromote) && (
                    <div className="mt-1.5 flex gap-1.5 border-t border-border/60 pt-2">
                      {canRetry && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 text-xs"
                          disabled={retryMutation.isPending}
                          onClick={() => retryMutation.mutate(version.id)}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry
                        </Button>
                      )}
                      {canPromote && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 text-xs"
                          disabled={promoteMutation.isPending}
                          onClick={() => promoteMutation.mutate(version.id)}
                        >
                          <Star className="mr-1 h-3.5 w-3.5" /> Make current
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
