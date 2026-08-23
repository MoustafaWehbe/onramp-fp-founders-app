import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { MultiSelect } from "../../../components/ui/multi-select";
import type { CreateConversationInput } from "../../../lib/chat-api";
import { listMembers } from "../../../lib/team-api";
import { qk } from "../../../lib/query-keys";
import { useAuth } from "../../../hooks/useAuth";

type NewChannelDialogProps = {
  startupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  onSubmit: (input: CreateConversationInput) => void;
};

export function NewChannelDialog({
  startupId,
  open,
  onOpenChange,
  isSubmitting,
  onSubmit,
}: NewChannelDialogProps) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const { user } = useAuth();

  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
    queryFn: () => listMembers(startupId),
    enabled: open,
  });

  const memberOptions = (membersQuery.data ?? [])
    .filter((member) => member.status === "active" && member.user && member.user.id !== user?.id)
    .map((member) => ({
      value: member.id,
      label: `${member.user!.firstName} ${member.user!.lastName}`.trim(),
      description: member.user!.email,
    }));

  useEffect(() => {
    if (!open) return;
    setName("");
    setTopic("");
    setMemberIds([]);
  }, [open]);

  const canSubmit = name.trim().length > 0 && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: name.trim(), topic: topic.trim() || undefined, memberIds });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
          <DialogDescription>
            You will be added automatically. Choose the teammates who should join you.
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
            <Label>Teammates</Label>
            <MultiSelect
              options={memberOptions}
              selected={memberIds}
              onChange={setMemberIds}
              placeholder={membersQuery.isLoading ? "Loading teammates…" : "Select teammates"}
              searchPlaceholder="Search teammates…"
              emptyText="No active teammates found."
              disabled={membersQuery.isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Only selected teammates can see this channel.
            </p>
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
