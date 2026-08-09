import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Button } from "../../../components/ui/button";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { listInvestors } from "../../../lib/investor-api";
import { STAGES, type PipelineStageId } from "../../../lib/mock-data";
import { fetchAllPages } from "../../../lib/pagination";
import { cn } from "../../../lib/utils";

export type AddDealValues = {
  investorId: string;
  stage: PipelineStageId;
  expectedAmount?: number;
};

type AddDealDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startupId: string;
  isSubmitting: boolean;
  onSubmit: (values: AddDealValues) => void;
};

export function AddDealDialog({
  open,
  onOpenChange,
  startupId,
  isSubmitting,
  onSubmit,
}: AddDealDialogProps) {
  const [investorId, setInvestorId] = useState("");
  const [stage, setStage] = useState<PipelineStageId>("sourced");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open) return;
    setInvestorId("");
    setStage("sourced");
    setAmount("");
  }, [open]);

  const contactsQuery = useQuery({
    queryKey: ["investors", startupId, "for-pipeline"],
    // Every unassigned contact has to be in this list for the picker to be
    // useful, so page through in small batches rather than asking for one big one.
    queryFn: () => fetchAllPages((page, limit) => listInvestors(startupId, { page, limit })),
    enabled: open,
  });

  const availableContacts = useMemo(
    () => (contactsQuery.data ?? []).filter((contact) => !contact.pipeline),
    [contactsQuery.data],
  );

  const selectedContact = availableContacts.find((contact) => contact.id === investorId);
  const selectedStage = STAGES.find((item) => item.id === stage) ?? STAGES[0];

  const parsedAmount = amount.trim() === "" ? undefined : Number(amount);
  const amountInvalid = parsedAmount !== undefined && Number.isNaN(parsedAmount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to pipeline</DialogTitle>
          <DialogDescription>
            Choose a contact that is not already on the board, then pick a starting stage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">Investor contact</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-9 w-full justify-between px-3 py-2 text-left font-normal"
                >
                  <span className="min-w-0 truncate">
                    {selectedContact
                      ? `${selectedContact.fullName}${
                          selectedContact.ventureFirm ? ` — ${selectedContact.ventureFirm}` : ""
                        }`
                      : contactsQuery.isLoading
                        ? "Loading contacts…"
                        : "Select a contact"}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
              >
                <DropdownMenuLabel>Available contacts</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {contactsQuery.isError && (
                  <DropdownMenuItem disabled>
                    Failed to load contacts — check you are signed in
                  </DropdownMenuItem>
                )}
                {!contactsQuery.isLoading &&
                  !contactsQuery.isError &&
                  availableContacts.length === 0 && (
                    <DropdownMenuItem disabled>
                      Every contact already has a pipeline entry
                    </DropdownMenuItem>
                  )}
                {availableContacts.map((contact) => (
                  <DropdownMenuItem key={contact.id} onSelect={() => setInvestorId(contact.id)}>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{contact.fullName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {contact.ventureFirm ?? contact.email ?? "No firm"}
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {!contactsQuery.isLoading && availableContacts.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {availableContacts.length} contact
                {availableContacts.length === 1 ? "" : "s"} ready to add
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Starting stage</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full justify-between px-3 font-normal"
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", selectedStage.dotClass)} />
                    {selectedStage.label}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                {STAGES.map((item) => (
                  <DropdownMenuItem key={item.id} onSelect={() => setStage(item.id)}>
                    <span className={cn("mr-2 h-2 w-2 rounded-full", item.dotClass)} />
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pipeline-amount">Expected amount (optional)</Label>
            <Input
              id="pipeline-amount"
              type="number"
              min={0}
              step={1000}
              placeholder="250000"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            {amountInvalid && (
              <p className="text-xs text-destructive">Expected amount must be a number.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!investorId || amountInvalid || isSubmitting}
            onClick={() => onSubmit({ investorId, stage, expectedAmount: parsedAmount })}
          >
            {isSubmitting ? "Adding…" : "Add to pipeline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
