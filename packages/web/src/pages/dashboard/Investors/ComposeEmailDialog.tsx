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
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";

export type ComposeFormValues = {
  subject: string;
  body: string;
};

type ComposeEmailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investorName: string;
  investorEmail: string;
  isSubmitting: boolean;
  onSubmit: (values: ComposeFormValues) => void;
};

/**
 * Deliberately plain text, matching every other free-text field in the
 * workspace (notes, interaction descriptions) rather than introducing the
 * app's first rich-text editor for one dialog.
 */
export function ComposeEmailDialog({
  open,
  onOpenChange,
  investorName,
  investorEmail,
  isSubmitting,
  onSubmit,
}: ComposeEmailDialogProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open) return;
    setSubject("");
    setBody("");
  }, [open]);

  const canSubmit = subject.trim() !== "" && body.trim() !== "" && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ subject: subject.trim(), body: body.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send email</DialogTitle>
          <DialogDescription>
            Sent from your connected Google account to {investorName} ({investorEmail}). Logged
            automatically once it sends.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="Following up on our conversation"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="compose-body">Message</Label>
            <Textarea
              id="compose-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              rows={8}
              placeholder="Hi..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
