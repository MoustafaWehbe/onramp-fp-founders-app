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
import {
  COMMITMENT_STATUSES,
  COMMITMENT_STATUS_HINTS,
  COMMITMENT_STATUS_LABELS,
} from "../../../lib/fundraising-api";
import type { CommitmentStatus } from "../../../lib/fundraising-api";
import type { CommitmentDraft } from "../../../lib/pipeline-api";
import { Select } from "../../../components/ui/select";

type CommitDialogProps = {
  open: boolean;
  investorName: string;
  roundName: string;
  /** Seeds the amount field — usually the deal's expected amount. */
  suggestedAmount: number | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (commitment: CommitmentDraft) => void;
};

/**
 * A deal reaching Committed and money being committed to the round are the
 * same event. Recording only the stage is what let the board and the round
 * page report different totals, so every path into Committed collects the
 * amount here and the server writes both together.
 */
export function CommitDialog({
  open,
  investorName,
  roundName,
  suggestedAmount,
  isSubmitting,
  onCancel,
  onConfirm,
}: CommitDialogProps) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<CommitmentStatus>("soft_circled");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(suggestedAmount == null ? "" : String(suggestedAmount));
    setStatus("soft_circled");
    setExpectedCloseDate("");
  }, [open, suggestedAmount]);

  const parsed = Number(amount.trim());
  const amountValid = amount.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record {investorName}'s commitment</DialogTitle>
          <DialogDescription>
            This is added to {roundName} as well as moving the deal, so the board and the round
            always show the same number.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="commit-amount">Amount</Label>
            <Input
              id="commit-amount"
              type="number"
              min={0}
              step={1000}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="250000"
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="commit-status">Status</Label>
              <Select
                id="commit-status"
                value={status}
                onValueChange={(next) => setStatus(next as CommitmentStatus)}
                options={COMMITMENT_STATUSES.map((option) => ({
                  value: option,
                  label: COMMITMENT_STATUS_LABELS[option],
                }))}
              />
              {/* The soft/hard distinction has to be made at the moment of
                  entry, or a verbal maybe gets filed as money in hand. */}
              <p className="text-xs text-muted-foreground">{COMMITMENT_STATUS_HINTS[status]}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commit-close">Expected close</Label>
              <Input
                id="commit-close"
                type="date"
                value={expectedCloseDate}
                onChange={(event) => setExpectedCloseDate(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!amountValid || isSubmitting}
            onClick={() =>
              onConfirm({
                amount: parsed,
                status,
                expectedCloseDate: expectedCloseDate
                  ? new Date(`${expectedCloseDate}T00:00:00`).toISOString()
                  : null,
              })
            }
          >
            {isSubmitting ? "Saving…" : "Record commitment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
