import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
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

  return (
    <Dialog open={Boolean(context)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {query.data?.document.title ?? "Reviewer document context"}
          </DialogTitle>
          <DialogDescription>
            {query.data
              ? `Version ${query.data.versionNumber} · page ${query.data.pageNumber}${context?.sectionLabel ? ` · ${context.sectionLabel}` : ""}`
              : "Loading the exact version and page reviewed by the investor."}
          </DialogDescription>
        </DialogHeader>

        {query.isPending ? (
          <div className="grid min-h-72 place-items-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : query.isError ? (
          <div className="grid min-h-72 place-items-center gap-3 text-center text-sm text-destructive">
            <AlertTriangle className="h-6 w-6" />
            <p>{apiErrorMessage(query.error, "Could not load this document page")}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : query.data ? (
          <div className="mx-auto overflow-hidden rounded-lg border border-border bg-muted/30">
            <img
              src={query.data.url}
              width={query.data.width}
              height={query.data.height}
              alt={`${query.data.document.title}, page ${query.data.pageNumber}`}
              className="max-h-[75vh] w-auto max-w-full object-contain"
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
