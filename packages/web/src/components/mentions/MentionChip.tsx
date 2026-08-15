import { MENTION_TYPE_ICONS } from "./mention-icons";
import type { MentionTargetType } from "../../lib/mentions";

type MentionChipProps = {
  type: MentionTargetType;
  label: string;
};

/**
 * The label always comes from the token itself (what the sender saw when
 * they picked it), not from a resolved lookup — so a chip still reads fine
 * even before /chat/resolve returns, or for a target the viewer can't read.
 * EntityUnfurl is where the live, permission-filtered detail lives.
 */
export function MentionChip({ type, label }: MentionChipProps) {
  const Icon = MENTION_TYPE_ICONS[type];
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/[0.08] px-1.5 py-0.5 align-middle text-[0.8em] font-medium text-primary">
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}
