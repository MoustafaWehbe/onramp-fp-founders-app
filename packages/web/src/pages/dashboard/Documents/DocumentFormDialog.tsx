import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import type { DocumentType } from "../../../lib/document-api";
import { TYPE_OPTIONS, formatFileSize, guessDocumentType } from "./document-types";

export type DocumentFormValues = {
  title: string;
  documentType: DocumentType;
  summary?: string;
};

type DocumentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  onSubmit: (input: DocumentFormValues) => void;
} & (
  | {
      mode: "create";
      /** The file already picked by the browser upload dialog. */
      file: File;
      initial?: never;
    }
  | {
      mode: "edit";
      file?: never;
      initial: { title: string; documentType: DocumentType };
    }
);

/**
 * One form for both moments a document's metadata is set: right after
 * picking a file (before any bytes reach the server) and later when
 * correcting it. Same fields, same layout — editing after the fact should
 * not look like a different feature from setting it up right the first time.
 */
export function DocumentFormDialog(props: DocumentFormDialogProps) {
  const { open, onOpenChange, isSubmitting, onSubmit, mode } = props;
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("other");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setTitle(props.file.name.replace(/\.[^.]+$/, "") || props.file.name);
      setDocumentType(guessDocumentType(props.file.name));
      setSummary("");
    } else {
      setTitle(props.initial.title);
      setDocumentType(props.initial.documentType);
    }
    // Depend on `open` alone: it flips false→true exactly once per dialog
    // opening, which is when the form should re-seed. Depending on `props.file`
    // / `props.initial` instead would re-seed (wiping in-progress edits) on
    // every parent re-render while open — the Documents list polls every few
    // seconds while anything is processing, so that would fire constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length >= 2 && !isSubmitting;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      title: trimmedTitle,
      documentType,
      ...(mode === "create" && summary.trim() ? { summary: summary.trim() } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Upload document" : "Edit document details"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Confirm the title and type before it's added to the data room."
              : "Update how this document is named and categorized."}
          </DialogDescription>
        </DialogHeader>

        {mode === "create" && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <FileText className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{props.file.name}</div>
              <div className="text-xs text-muted-foreground">{formatFileSize(props.file.size)}</div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Series A pitch deck"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-type">Document type</Label>
            <Select
              id="doc-type"
              value={documentType}
              onValueChange={(value) => setDocumentType(value as DocumentType)}
              options={TYPE_OPTIONS}
            />
          </div>
          {mode === "create" && (
            <div className="space-y-2">
              <Label htmlFor="doc-summary">Summary (optional)</Label>
              <Textarea
                id="doc-summary"
                value={summary}
                maxLength={500}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="A short note about what this document covers"
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {isSubmitting
              ? mode === "create"
                ? "Uploading…"
                : "Saving…"
              : mode === "create"
                ? "Upload"
                : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
