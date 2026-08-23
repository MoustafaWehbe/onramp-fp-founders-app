import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { apiErrorMessage } from "../../../lib/api-error";
import { getDocumentPageAccess } from "../../../lib/document-api";

export type DocumentPageContext = {
  documentId: string;
  versionId: string;
  pageNumber: number;
  sectionLabel: string | null;
};

export function DocumentPagePreviewDialog({
  startupId,
  context,
  onOpenChange,
}: {
  startupId: string;
  context: DocumentPageContext | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [zoom, setZoom] = useState(100);
  const [imageFailed, setImageFailed] = useState(false);
  const query = useQuery({
    queryKey: [
      "documents",
      startupId,
      context?.documentId,
      context?.versionId,
      "page",
      context?.pageNumber,
    ],
    queryFn: () =>
      getDocumentPageAccess(
        startupId,
        context!.documentId,
        context!.versionId,
        context!.pageNumber,
      ),
    enabled: Boolean(context),
    staleTime: 4 * 60 * 1000,
  });

  useEffect(() => {
    setZoom(100);
    setImageFailed(false);
  }, [query.data?.url]);

  const title = query.data?.document.title ?? "Reviewer document context";
  const pageLabel = query.data
    ? `Version ${query.data.versionNumber}, page ${query.data.pageNumber}${context?.sectionLabel ? `, ${context.sectionLabel}` : ""}`
    : "Loading the exact version and page reviewed by the investor.";

  return (
    <Dialog open={Boolean(context)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[96dvh] max-w-5xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{pageLabel}</DialogDescription>
        </DialogHeader>

        {query.isPending ? (
          <div
            className="grid min-h-72 place-items-center text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="sr-only">Loading document page</span>
          </div>
        ) : query.isError || imageFailed ? (
          <div
            className="grid min-h-72 place-items-center gap-3 text-center text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle className="h-6 w-6" />
            <p>
              {imageFailed
                ? "The page image could not be displayed. Its secure link may have expired."
                : apiErrorMessage(query.error, "Could not load this document page")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setImageFailed(false);
                void query.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : query.data ? (
          <div className="min-w-0 space-y-2">
            <div
              className="flex flex-wrap items-center justify-between gap-2"
              aria-label="Page preview controls"
            >
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Zoom out"
                  disabled={zoom <= 50}
                  onClick={() => setZoom((value) => Math.max(50, value - 25))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-14 text-center text-xs tabular-nums" aria-live="polite">
                  {zoom}%
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Zoom in"
                  disabled={zoom >= 200}
                  onClick={() => setZoom((value) => Math.min(200, value + 25))}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Reset zoom"
                  disabled={zoom === 100}
                  onClick={() => setZoom(100)}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => window.open(query.data.url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="mr-1.5 h-4 w-4" /> Open page
              </Button>
            </div>
            <figure className="max-h-[calc(96dvh-12rem)] overflow-auto overscroll-contain rounded-lg border border-border bg-muted/30">
              <img
                src={query.data.url}
                width={query.data.width}
                height={query.data.height}
                alt={`${query.data.document.title}, page ${query.data.pageNumber}`}
                draggable={false}
                onError={() => setImageFailed(true)}
                className="mx-auto h-auto max-w-none object-contain transition-[width] duration-150 motion-reduce:transition-none"
                style={{ width: `${zoom}%` }}
              />
              <figcaption className="sr-only">
                {title}. {pageLabel}.
              </figcaption>
            </figure>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
