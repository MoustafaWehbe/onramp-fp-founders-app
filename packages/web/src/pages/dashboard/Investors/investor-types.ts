import type { PipelineStageId } from "../../../lib/mock-data";
import type { InvestorContact } from "../../../lib/pipeline-api";

export type InvestorRow = {
  id: string;
  name: string;
  email: string;
  firm: string;
  sector: string;
  stagePreference: string;
  pipelineStageId: PipelineStageId | null;
  pipelineId: string | null;
  amount: number | null;
  lastContact: string;
  linkedinUrl: string | null;
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

export function mapContactToRow(contact: InvestorContact): InvestorRow {
  return {
    id: contact.id,
    name: contact.fullName,
    email: contact.email ?? "",
    firm: contact.ventureFirm ?? "—",
    sector: contact.sectorFocus ?? "—",
    stagePreference: contact.investmentStagePreference ?? "—",
    pipelineStageId: contact.pipeline?.stage ?? null,
    pipelineId: contact.pipeline?.id ?? null,
    amount: contact.pipeline?.expectedAmount ?? null,
    lastContact: formatRelativeDate(contact.nextFollowupDate ?? contact.updatedAt),
    linkedinUrl: contact.linkedinUrl,
  };
}
