import {
  Ban,
  Check,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Share2,
  ShieldQuestion,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

export type ActionTone = "success" | "info" | "danger" | "warning" | "neutral";

type ActionMeta = {
  /** Past-tense verb used in the row sentence, e.g. "created". */
  verb: string;
  icon: LucideIcon;
  tone: ActionTone;
};

const ACTION_META: Record<string, ActionMeta> = {
  create: { verb: "created", icon: Plus, tone: "success" },
  update: { verb: "updated", icon: Pencil, tone: "info" },
  delete: { verb: "deleted", icon: Trash2, tone: "danger" },
  revoke: { verb: "revoked", icon: Ban, tone: "warning" },
  login: { verb: "logged in", icon: LogIn, tone: "success" },
  logout: { verb: "logged out", icon: LogOut, tone: "neutral" },
  accept: { verb: "accepted", icon: Check, tone: "success" },
  decline: { verb: "declined", icon: X, tone: "warning" },
  share: { verb: "shared", icon: Share2, tone: "info" },
};

const DEFAULT_ACTION_META: ActionMeta = { verb: "acted on", icon: ShieldQuestion, tone: "neutral" };

/** Actions that read as a complete sentence on their own — no entity to name. */
const STANDALONE_ACTIONS = new Set(["login", "logout"]);

export function actionMeta(action: string): ActionMeta {
  return ACTION_META[action] ?? DEFAULT_ACTION_META;
}

const TONE_CLASSES: Record<ActionTone, string> = {
  success: "bg-success/15 text-success",
  info: "bg-primary/15 text-primary",
  danger: "bg-destructive/15 text-destructive",
  warning: "bg-warning/20 text-warning",
  neutral: "bg-muted text-muted-foreground",
};

export function actionToneClass(tone: ActionTone): string {
  return TONE_CLASSES[tone];
}

export function entityLabel(entityType: string): string {
  return entityType.replace(/_/g, " ");
}

export function actionLabel(action: string): string {
  return action.replace(/_/g, " ");
}

/** "created a document" / "logged in" — the sentence fragment after the actor's name. */
export function describeAction(action: string, entityType: string): string {
  const meta = actionMeta(action);
  if (STANDALONE_ACTIONS.has(action)) return meta.verb;
  return `${meta.verb} a ${entityLabel(entityType)}`;
}
