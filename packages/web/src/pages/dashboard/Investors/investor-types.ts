import type { PipelineStageId } from "../../../lib/pipeline-stages";
import type { InvestorListItem, InvestorType } from "../../../lib/investor-api";

export type InvestorRow = {
  id: string;
  name: string;
  email: string;
  firm: string;
  sector: string;
  stagePreference: string;
  investorType: InvestorType | null;
  pipelineStageId: PipelineStageId | null;
  pipelineId: string | null;
  /** Which round `amount` belongs to look up its currency, never assume USD. */
  roundId: string | null;
  amount: number | null;
  lastContact: string;
  linkedinUrl: string | null;
  /** Kept so the edit dialog can be opened straight from a row. */
  contact: InvestorListItem;
};

function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round(diffMs / dayMs);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 45) return `${Math.round(days / 7)} weeks ago`;
  return date.toLocaleDateString();
}

export function mapContactToRow(contact: InvestorListItem): InvestorRow {
  return {
    id: contact.id,
    name: contact.fullName,
    email: contact.email ?? "",
    firm: contact.ventureFirm ?? "—",
    sector: contact.sectorFocus ?? "—",
    stagePreference: contact.investmentStagePreference ?? "—",
    investorType: contact.investorType,
    pipelineStageId: contact.pipeline?.stage ?? null,
    pipelineId: contact.pipeline?.id ?? null,
    roundId: contact.pipeline?.roundId ?? null,
    amount: contact.pipeline?.expectedAmount ?? null,
    // Strictly the last interaction on record. It used to read
    // nextFollowupDate a *future* date, which formatRelativeDate renders as
    // "Today" falling back to updatedAt, which moves when the contact's
    // details are edited rather than when anyone spoke to them.
    lastContact: formatRelativeDate(contact.lastInteractionDate),
    linkedinUrl: contact.linkedinUrl,
    contact,
  };
}
