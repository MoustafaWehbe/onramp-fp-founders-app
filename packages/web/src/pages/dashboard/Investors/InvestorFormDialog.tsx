import { useEffect, useState } from "react";
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
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  INVESTOR_TYPES,
  INVESTOR_TYPE_LABELS,
  type InvestorContact,
  type InvestorInput,
  type InvestorType,
} from "../../../lib/investor-api";

type InvestorFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when adding. */
  investor?: InvestorContact | null;
  isSubmitting: boolean;
  onSubmit: (input: InvestorInput) => void;
};

type FormState = {
  fullName: string;
  email: string;
  ventureFirm: string;
  investorType: InvestorType | "";
  sectorFocus: string;
  investmentStagePreference: string;
  linkedinUrl: string;
  source: string;
};

const EMPTY: FormState = {
  fullName: "",
  email: "",
  ventureFirm: "",
  investorType: "",
  sectorFocus: "",
  investmentStagePreference: "",
  linkedinUrl: "",
  source: "",
};

function toFormState(investor: InvestorContact | null | undefined): FormState {
  if (!investor) return EMPTY;
  return {
    fullName: investor.fullName,
    email: investor.email ?? "",
    ventureFirm: investor.ventureFirm ?? "",
    investorType: investor.investorType ?? "",
    sectorFocus: investor.sectorFocus ?? "",
    investmentStagePreference: investor.investmentStagePreference ?? "",
    linkedinUrl: investor.linkedinUrl ?? "",
    source: investor.source ?? "",
  };
}

// Blank optional fields are sent as null rather than "" so that clearing a
// value actually clears it server-side instead of being rejected or ignored.
function toInput(form: FormState): InvestorInput {
  const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

  return {
    fullName: form.fullName.trim(),
    email: orNull(form.email),
    ventureFirm: orNull(form.ventureFirm),
    investorType: form.investorType === "" ? null : form.investorType,
    sectorFocus: orNull(form.sectorFocus),
    investmentStagePreference: orNull(form.investmentStagePreference),
    linkedinUrl: orNull(form.linkedinUrl),
    source: orNull(form.source),
  };
}

export function InvestorFormDialog({
  open,
  onOpenChange,
  investor,
  isSubmitting,
  onSubmit,
}: InvestorFormDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showMore, setShowMore] = useState(false);
  const isEditing = Boolean(investor);

  useEffect(() => {
    if (!open) return;
    const next = toFormState(investor);
    setForm(next);
    // Start expanded when any of those fields already carry data, so editing
    // never hides something the record actually has.
    setShowMore(
      Boolean(
        next.sectorFocus || next.investmentStagePreference || next.linkedinUrl || next.source,
      ),
    );
  }, [open, investor]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Mirrors the server's zod rules so the common mistakes surface inline.
  const nameValid = form.fullName.trim().length >= 2;
  const emailValid = form.email.trim() === "" || /^\S+@\S+\.\S+$/.test(form.email.trim());
  const linkedinValid =
    form.linkedinUrl.trim() === "" || /^https?:\/\/\S+\.\S+/i.test(form.linkedinUrl.trim());
  const canSubmit = nameValid && emailValid && linkedinValid && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(toInput(form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit investor" : "Add investor"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update what you know about this contact."
              : "Add a contact to your directory. They stay a prospect until you add them to the pipeline or log an interaction."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="investor-name">Full name</Label>
            <Input
              id="investor-name"
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              maxLength={150}
              placeholder="Ada Lovelace"
              required
            />
            {form.fullName.trim() !== "" && !nameValid && (
              <p className="text-xs text-destructive">Name must be at least 2 characters</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="investor-email">Email</Label>
              <Input
                id="investor-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="ada@fund.com"
              />
              {!emailValid && <p className="text-xs text-destructive">Enter a valid email</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="investor-firm">Firm</Label>
              <Input
                id="investor-firm"
                value={form.ventureFirm}
                onChange={(e) => set("ventureFirm", e.target.value)}
                maxLength={150}
                placeholder="Acme Ventures"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Type</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full justify-between px-3 font-normal sm:w-1/2 sm:pr-8"
                >
                  {form.investorType === ""
                    ? "Not set"
                    : INVESTOR_TYPE_LABELS[form.investorType]}
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                <DropdownMenuItem onSelect={() => set("investorType", "")}>
                  Not set
                </DropdownMenuItem>
                {INVESTOR_TYPES.map((type) => (
                  <DropdownMenuItem key={type} onSelect={() => set("investorType", type)}>
                    {INVESTOR_TYPE_LABELS[type]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <button
            type="button"
            onClick={() => setShowMore((prev) => !prev)}
            aria-expanded={showMore}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? "rotate-180" : ""}`} />
            {showMore ? "Hide details" : "More details"}
          </button>

          {showMore && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="investor-sector">Sector focus</Label>
                  <Input
                    id="investor-sector"
                    value={form.sectorFocus}
                    onChange={(e) => set("sectorFocus", e.target.value)}
                    maxLength={200}
                    placeholder="Fintech, SaaS"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="investor-stage-pref">Stage preference</Label>
                  <Input
                    id="investor-stage-pref"
                    value={form.investmentStagePreference}
                    onChange={(e) => set("investmentStagePreference", e.target.value)}
                    maxLength={200}
                    placeholder="Seed to Series A"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="investor-source">Source</Label>
                <Input
                  id="investor-source"
                  value={form.source}
                  onChange={(e) => set("source", e.target.value)}
                  maxLength={100}
                  placeholder="Warm intro, conference…"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="investor-linkedin">LinkedIn</Label>
                <Input
                  id="investor-linkedin"
                  type="url"
                  value={form.linkedinUrl}
                  onChange={(e) => set("linkedinUrl", e.target.value)}
                  placeholder="https://linkedin.com/in/…"
                />
                {!linkedinValid && (
                  <p className="text-xs text-destructive">
                    Include the full address, starting with http:// or https://
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Add investor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
