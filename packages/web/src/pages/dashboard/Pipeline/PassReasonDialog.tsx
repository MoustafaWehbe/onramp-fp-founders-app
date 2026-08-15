import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Textarea } from "../../../components/ui/textarea";

/** Convenience chips only the field itself stays free text. */
const SUGGESTIONS = ["Not a fit", "Timing", "No response", "Went with another investor"];

type PassReasonDialogProps = {
  open: boolean;
  investorName: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

/**
 * The server refuses a move to "passed" without a reason, so every path that
 * can make that move has to collect one first the deal sheet's button, the
 * card's stage menu, and a drag into the Passed column all share this.
 */
export function PassReasonDialog({
  open,
  investorName,
  isSubmitting,
  onCancel,
  onConfirm,
}: PassReasonDialogProps) {
  const [reason, setReason] = useState("");

  // A reason typed for one deal must never carry over to the next.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Why did {investorName} pass?</DialogTitle>
          <DialogDescription>
            This is kept on the deal's history reopening later doesn't erase it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setReason(suggestion)}
              className="rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this deal passing?"
          maxLength={500}
          rows={3}
          autoFocus
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={reason.trim() === "" || isSubmitting}
            onClick={() => onConfirm(reason.trim())}
          >
            {isSubmitting ? "Saving…" : "Mark as passed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
