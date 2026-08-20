import { z } from "zod";
import { Clipboard, FileCheck2, GitCompareArrows, Mail, ShieldAlert, UsersRound } from "lucide-react";
import type { AiArtifact } from "../../../../lib/ai-api";

const sourceAnswer = z.object({
  answer: z.string().min(1).max(20_000),
  sources: z.array(z.object({ label: z.string().min(1).max(300), excerpt: z.string().max(1_500).nullable() })).max(20),
});
const comparison = z.object({
  title: z.string().min(1).max(160),
  fields: z.array(z.object({ label: z.string().min(1).max(120), left: z.string().max(2_000), right: z.string().max(2_000), changed: z.boolean() })).min(1).max(30),
});
const emailDraft = z.object({ subject: z.string().min(1).max(240), body: z.string().min(1).max(20_000), contextLabel: z.string().min(1).max(300), missingInvestorContext: z.boolean() });
const meetingBrief = z.object({ title: z.string().min(1).max(240), talkingPoints: z.array(z.string().min(1).max(1_000)).min(1).max(10), contextLabel: z.string().min(1).max(300), missingInvestorContext: z.boolean() });

export function AiArtifactRenderer({ artifact }: { artifact: AiArtifact }) {
  if (artifact.type === "source_answer.v1") {
    const parsed = sourceAnswer.safeParse(artifact.data);
    if (parsed.success) return <ArtifactShell title={artifact.title ?? "Grounded answer"} icon={<FileCheck2 className="h-4 w-4" />}><p className="whitespace-pre-wrap text-sm leading-relaxed">{parsed.data.answer}</p><details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">{parsed.data.sources.length} verified source{parsed.data.sources.length === 1 ? "" : "s"}</summary><ul className="mt-2 space-y-1">{parsed.data.sources.map((source, index) => <li key={`${source.label}-${index}`}>{source.label}{source.excerpt ? ` — ${source.excerpt}` : ""}</li>)}</ul></details></ArtifactShell>;
  }
  if (artifact.type === "comparison.v1") {
    const parsed = comparison.safeParse(artifact.data);
    if (parsed.success) return <ArtifactShell title={parsed.data.title} icon={<GitCompareArrows className="h-4 w-4" />}><dl className="mt-2 divide-y text-xs">{parsed.data.fields.map((field) => <div key={field.label} className="grid grid-cols-3 gap-2 py-2"><dt className="font-medium">{field.label}</dt><dd>{field.left}</dd><dd className={field.changed ? "font-medium text-primary" : ""}>{field.right}</dd></div>)}</dl></ArtifactShell>;
  }
  if (artifact.type === "email_draft.v1") {
    const parsed = emailDraft.safeParse(artifact.data);
    if (parsed.success) return <ArtifactShell title={artifact.title ?? "Follow-up draft"} icon={<Mail className="h-4 w-4" />}><p className="text-xs text-muted-foreground">{parsed.data.contextLabel}</p><p className="mt-3 text-sm font-medium">Subject: {parsed.data.subject}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{parsed.data.body}</p><CopyButton value={`Subject: ${parsed.data.subject}\n\n${parsed.data.body}`} /></ArtifactShell>;
  }
  if (artifact.type === "meeting_brief.v1") {
    const parsed = meetingBrief.safeParse(artifact.data);
    if (parsed.success) return <ArtifactShell title={parsed.data.title} icon={<UsersRound className="h-4 w-4" />}><p className="text-xs text-muted-foreground">{parsed.data.contextLabel}</p><ul className="mt-3 list-disc space-y-1 pl-4 text-sm">{parsed.data.talkingPoints.map((point, index) => <li key={index}>{point}</li>)}</ul><CopyButton value={`${parsed.data.title}\n\n${parsed.data.talkingPoints.map((point) => `• ${point}`).join("\n")}`} /></ArtifactShell>;
  }
  return <div className="mt-3 flex items-center gap-2 rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground"><ShieldAlert className="h-4 w-4 shrink-0" />This AI result uses an unsupported or invalid display format. The conversation text remains available.</div>;
}

function ArtifactShell({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="mt-3 rounded-lg border bg-background p-3 text-left"><div className="flex items-center gap-2 text-sm font-medium">{icon}{title}</div><div className="mt-2">{children}</div></section>;
}

function CopyButton({ value }: { value: string }) {
  return <button type="button" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => void navigator.clipboard?.writeText(value)}><Clipboard className="h-3.5 w-3.5" /> Copy draft</button>;
}
