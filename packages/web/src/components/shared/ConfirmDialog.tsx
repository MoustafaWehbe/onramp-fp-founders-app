import type { ReactNode } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** Label for the action being confirmed say what happens, not "OK". */
  confirmLabel: string;
  /** Shown on the confirm button while the mutation runs. */
  pendingLabel?: string;
  cancelLabel?: string;
  /** Destructive styling is the default because most confirmations remove something. */
  variant?: "destructive" | "default";
  isPending?: boolean;
  onConfirm: () => void;
};

/**
 * One confirmation prompt for every high-impact action in the workspace, so
 * "are you sure" always looks and behaves the same: the consequence stated in
 * the body, the verb on the button, and no way to fire the action twice while
 * it is in flight.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  variant = "destructive",
  isPending = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={isPending} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={variant} disabled={isPending} onClick={onConfirm}>
            {isPending ? (pendingLabel ?? "Working…") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
