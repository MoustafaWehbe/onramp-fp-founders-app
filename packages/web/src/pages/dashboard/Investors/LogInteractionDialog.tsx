import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { DateTimePicker } from "../../../components/ui/date-time-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import {
  INTERACTION_TYPES,
  INTERACTION_TYPE_LABELS,
  type InteractionLog,
  type InteractionType,
} from "../../../lib/interaction-log-api";

export type LogFormValues = {
  type: InteractionType;
  interactionDate: string;
  subject: string | null;
  description: string | null;
};

type LogInteractionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investorName: string;
  /** Present when editing an existing entry. */
  log?: InteractionLog | null;
  isSubmitting: boolean;
  onSubmit: (values: LogFormValues) => void;
};

export function LogInteractionDialog({
  open,
  onOpenChange,
  investorName,
  log,
  isSubmitting,
  onSubmit,
}: LogInteractionDialogProps) {
  const [type, setType] = useState<InteractionType>("call");
  const [interactionDate, setInteractionDate] = useState<Date | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const isEditing = Boolean(log);

  useEffect(() => {
    if (!open) return;
    setType(log?.type ?? "call");
    // A new entry defaults to now most interactions are logged just after
    // they happen.
    setInteractionDate(log?.interactionDate ? new Date(log.interactionDate) : new Date());
    setSubject(log?.subject ?? "");
    setDescription(log?.description ?? "");
  }, [open, log]);

  const canSubmit = interactionDate !== null && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    onSubmit({
      type,
      interactionDate: interactionDate.toISOString(),
      // Empty strings become null so clearing a field actually clears it.
      subject: subject.trim() === "" ? null : subject.trim(),
      description: description.trim() === "" ? null : description.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit interaction" : "Log interaction"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Update what you recorded with ${investorName}.`
              : `Record a conversation with ${investorName}. Logging one moves them out of Prospects.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Type</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full justify-between px-3 font-normal"
                  >
                    {INTERACTION_TYPE_LABELS[type]}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-(--radix-dropdown-menu-trigger-width)"
                >
                  {INTERACTION_TYPES.map((option) => (
                    <DropdownMenuItem key={option} onSelect={() => setType(option)}>
                      {INTERACTION_TYPE_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2">
              <Label htmlFor="log-date">When</Label>
              <DateTimePicker id="log-date" value={interactionDate} onChange={setInteractionDate} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="log-subject">Subject</Label>
            <Input
              id="log-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="Intro call, follow-up on metrics…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="log-description">Notes</Label>
            <Textarea
              id="log-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="What was discussed, and what happens next."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Log interaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
