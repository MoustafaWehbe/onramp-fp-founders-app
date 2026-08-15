import { useEffect, useState } from "react";
import { Phone, Video } from "lucide-react";
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
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import type { MeetingType } from "../../../lib/calendar-api";

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120].map((minutes) => ({
  value: String(minutes),
  label: minutes < 60 ? `${minutes} min` : minutes === 60 ? "1 hour" : `${minutes / 60} hours`,
}));

export type ScheduleFormValues = {
  type: MeetingType;
  startDateTime: string;
  durationMinutes: number;
  subject: string | null;
  description: string | null;
};

type ScheduleMeetingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investorName: string;
  investorEmail: string;
  isSubmitting: boolean;
  onSubmit: (values: ScheduleFormValues) => void;
};

/**
 * Creates a Google Calendar event with the investor invited, rather than
 * just recording that a call/meeting happened that's what "schedule"
 * means here, distinct from the edit path (LogInteractionDialog), which
 * still handles correcting an entry after the fact.
 */
export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  investorName,
  investorEmail,
  isSubmitting,
  onSubmit,
}: ScheduleMeetingDialogProps) {
  const [type, setType] = useState<MeetingType>("call");
  const [startDateTime, setStartDateTime] = useState<Date | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setType("call");
    setStartDateTime(null);
    setDurationMinutes(30);
    setSubject("");
    setDescription("");
  }, [open]);

  const canSubmit = startDateTime !== null && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    onSubmit({
      type,
      startDateTime: startDateTime.toISOString(),
      durationMinutes,
      subject: subject.trim() === "" ? null : subject.trim(),
      description: description.trim() === "" ? null : description.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule a call or meeting</DialogTitle>
          <DialogDescription>
            Creates a Google Calendar invite to {investorName} ({investorEmail}) from your
            connected account, and logs it against this investor.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">Type</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "call", label: "Call", icon: Phone },
                  { value: "meeting", label: "Meeting", icon: Video },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  aria-pressed={type === value}
                  className={cn(
                    "flex h-9 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors",
                    type === value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-date">When</Label>
              <DateTimePicker
                id="schedule-date"
                value={startDateTime}
                onChange={setStartDateTime}
                minDate={new Date()}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-duration">Duration</Label>
              <Select
                id="schedule-duration"
                value={String(durationMinutes)}
                onValueChange={(value) => setDurationMinutes(Number(value))}
                options={DURATION_OPTIONS}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-subject">Subject</Label>
            <Input
              id="schedule-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder={type === "call" ? `Call with ${investorName}` : `Meeting with ${investorName}`}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-description">Notes</Label>
            <Textarea
              id="schedule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Agenda or context, included in the calendar invite."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Scheduling…" : "Schedule & invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
