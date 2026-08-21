import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed [&:not(:first-child)]:mt-3">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mt-4 text-xl font-semibold text-foreground first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 text-lg font-semibold text-foreground first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 text-base font-semibold text-foreground first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 text-base font-semibold text-foreground first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-muted-foreground first:mt-0">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground first:mt-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
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

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-base leading-relaxed text-foreground/95", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
