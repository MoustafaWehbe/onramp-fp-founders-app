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
import type { CreateConversationInput } from "../../../lib/chat-api";

type NewChannelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  onSubmit: (input: CreateConversationInput) => void;
};

export function NewChannelDialog({
  open,
  onOpenChange,
  isSubmitting,
  onSubmit,
}: NewChannelDialogProps) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setTopic("");
  }, [open]);

  const canSubmit = name.trim().length > 0 && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: name.trim(), topic: topic.trim() || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
          <DialogDescription>
            Every active teammate is added automatically there's no separate invite step yet.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              placeholder="fundraising-updates"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              autoComplete="off"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-topic">Topic (optional)</Label>
            <Input
              id="channel-topic"
              placeholder="What's this channel for?"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={200}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
