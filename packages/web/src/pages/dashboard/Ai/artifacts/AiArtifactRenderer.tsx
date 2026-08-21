import { useState, type ReactNode } from "react";
import { z } from "zod";
import { Check, Clipboard, FileCheck2, GitCompareArrows, Mail, ShieldAlert, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Markdown } from "../../../../components/shared/Markdown";
import { cn } from "../../../../lib/utils";
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
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell icon={FileCheck2} title={artifact.title ?? "Grounded answer"}>
        <Markdown>{parsed.data.answer}</Markdown>
        {parsed.data.sources.length > 0 && <SourceList sources={parsed.data.sources} />}
      </ArtifactShell>
    );
  }

  if (artifact.type === "comparison.v1") {
    const parsed = comparison.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell icon={GitCompareArrows} title={parsed.data.title}>
        <dl className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {parsed.data.fields.map((field) => (
            <div key={field.label} className="grid grid-cols-3 gap-2 bg-background/40 px-3 py-2 text-xs">
              <dt className="font-medium text-muted-foreground">{field.label}</dt>
              <dd className="text-foreground/80">{field.left}</dd>
              <dd className={cn(field.changed && "font-medium text-primary")}>{field.right}</dd>
            </div>
          ))}
        </dl>
      </ArtifactShell>
    );
  }

  if (artifact.type === "email_draft.v1") {
    const parsed = emailDraft.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell
        icon={Mail}
        title={artifact.title ?? "Follow-up draft"}
        action={<CopyButton value={`Subject: ${parsed.data.subject}\n\n${parsed.data.body}`} />}
      >
        <p className="text-xs text-muted-foreground">{parsed.data.contextLabel}</p>
        <p className="mt-3 text-sm font-medium text-foreground">Subject: {parsed.data.subject}</p>
        <Markdown className="mt-2">{parsed.data.body}</Markdown>
      </ArtifactShell>
    );
  }

  if (artifact.type === "meeting_brief.v1") {
    const parsed = meetingBrief.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell
        icon={UsersRound}
        title={parsed.data.title}
        action={<CopyButton value={`${parsed.data.title}\n\n${parsed.data.talkingPoints.map((point) => `• ${point}`).join("\n")}`} />}
      >
        <p className="text-xs text-muted-foreground">{parsed.data.contextLabel}</p>
        <ul className="mt-3 space-y-1.5">
          {parsed.data.talkingPoints.map((point, index) => (
            <li key={index} className="flex items-start gap-2 text-sm leading-relaxed text-foreground/90">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              {point}
            </li>
          ))}
        </ul>
      </ArtifactShell>
    );
  }

  return <UnsupportedArtifact />;
}

function ArtifactShell({ icon: Icon, title, action, children }: { icon: LucideIcon; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-2 max-w-full rounded-xl border border-border/60 bg-card/60 p-4 text-left shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3 className="flex-1 truncate text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SourceList({ sources }: { sources: Array<{ label: string; excerpt: string | null }> }) {
  return (
    <details className="group mt-3 rounded-lg border border-border/60 bg-background/40 text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-medium text-muted-foreground marker:content-none">
        <span>{sources.length} verified source{sources.length === 1 ? "" : "s"}</span>
        <span className="text-[10px] text-muted-foreground/70 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <ul className="space-y-2 border-t border-border/60 px-3 py-2">
        {sources.map((source, index) => (
          <li key={`${source.label}-${index}`} className="leading-relaxed">
            <span className="font-medium text-foreground/80">{source.label}</span>
            {source.excerpt && <span className="text-muted-foreground"> — {source.excerpt}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Clipboard className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function UnsupportedArtifact() {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      This AI result uses an unsupported or invalid display format. The conversation text remains available.
    </div>
  );
}
