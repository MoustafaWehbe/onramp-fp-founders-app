import { createContext, memo, useContext } from "react";
import { AlertTriangle, Check } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";

type ListTone = "positive" | "negative" | null;
const ListToneContext = createContext<ListTone>(null);

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
};

function headingText(node: MarkdownNode): string {
  if (node.value) return node.value;
  if (Array.isArray(node.children)) return node.children.map(headingText).join("");
  return "";
}

// Tags the bullet list immediately following a "Strengths" / "Weaknesses"
// (or Gaps/Areas for Improvement) heading with a tone, so it can render with
// distinct positive/negative styling instead of a plain generic bullet —
// the model is instructed to use exactly these heading words for this to
// activate reliably.
function remarkToneLists() {
  return (tree: MarkdownNode) => {
    let tone: ListTone = null;
    for (const node of tree.children ?? []) {
      if (node.type === "heading") {
        const text = headingText(node).toLowerCase();
        if (/\bstrength/.test(text)) tone = "positive";
        else if (/\bweakness|\bgap|\bimprovement|\bconcern|\brisk/.test(text)) tone = "negative";
        else tone = null;
      } else if (node.type === "list") {
        if (tone) {
          node.data ??= {};
          node.data.hProperties = { ...(node.data.hProperties ?? {}), className: `tone-${tone}` };
        }
        tone = null;
      }
    }
  };
}

function ListItem({ children }: { children?: React.ReactNode }) {
  const tone = useContext(ListToneContext);
  if (tone === "positive") {
    return (
      <li className="flex items-start gap-2">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        <span>{children}</span>
      </li>
    );
  }
  if (tone === "negative") {
    return (
      <li className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>{children}</span>
      </li>
    );
  }
  return <li className="pl-0.5">{children}</li>;
}

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed not-first:mt-3">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 border-b border-border/60 pb-1.5 text-xl font-bold tracking-tight text-foreground first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-5 text-lg font-semibold text-foreground first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</h4>,
  ul: ({ children, className }) => {
    const tone: ListTone = className?.includes("tone-positive") ? "positive" : className?.includes("tone-negative") ? "negative" : null;
    return (
      <ListToneContext.Provider value={tone}>
        <ul className={cn("mt-2 space-y-1.5 first:mt-0", tone ? "list-none pl-0" : "list-disc space-y-1 pl-5 marker:text-muted-foreground")}>{children}</ul>
      </ListToneContext.Provider>
    );
  },
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground first:mt-0">{children}</ol>,
  li: ListItem,
  blockquote: ({ children }) => <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-muted-foreground first:mt-0">{children}</blockquote>,
  hr: () => <hr className="my-4 border-border/60" />,
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(className ?? "");
    if (!isBlock) {
      return (
        <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.85em] text-foreground" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={cn("font-mono text-[0.85em] text-foreground", className)} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="scrollbar-slim mt-2 overflow-x-auto rounded-lg border border-border/60 bg-background/60 p-3 first:mt-0">{children}</pre>,
  table: ({ children }) => (
    <div className="scrollbar-slim mt-2 overflow-x-auto rounded-lg border border-border/60 first:mt-0">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface/60">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border/60 px-2.5 py-1.5 font-medium text-muted-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/40 px-2.5 py-1.5 align-top text-foreground/90">{children}</td>,
};

const remarkPlugins = [remarkGfm, remarkToneLists];

// Memoized: parsing markdown into an AST is real work, and a parent re-render
// (e.g. a tool-call status update) shouldn't force it to redo that work when
// the text itself hasn't changed.
export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-base leading-relaxed text-foreground/95", className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
