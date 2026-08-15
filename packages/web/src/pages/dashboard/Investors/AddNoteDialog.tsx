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

type AddNoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investorName: string;
  isSubmitting: boolean;
  onSubmit: (description: string) => void;
};

/**
 * Notes are logged the same way a call or meeting is a "note" typed
 * interaction, timestamped now rather than living in a separate freeform
 * field on the contact. That keeps the timeline the one place relationship
 * history accumulates, instead of splitting it between there and Overview.
 */
export function AddNoteDialog({
  open,
  onOpenChange,
  investorName,
  isSubmitting,
  onSubmit,
}: AddNoteDialogProps) {
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setDescription("");
  }, [open]);

  const canSubmit = description.trim() !== "" && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(description.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a note</DialogTitle>
          <DialogDescription>
            Shared relationship context about {investorName}, visible to your whole team.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="Preferences, relationship history, anything worth remembering…"
            autoFocus
          />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Saving…" : "Add note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
