import { Briefcase, FileText, ListChecks, User, Users, Wallet, type LucideIcon } from "lucide-react";
import type { MentionTargetType } from "../../lib/mentions";

/** Same icon a mention type uses everywhere else in the app — Investors, Pipeline, Tasks, Rounds, Documents. */
export const MENTION_TYPE_ICONS: Record<MentionTargetType, LucideIcon> = {
  member: User,
  investor: Users,
  deal: Briefcase,
  task: ListChecks,
  round: Wallet,
  document: FileText,
};
