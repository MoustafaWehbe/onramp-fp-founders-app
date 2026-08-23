import type { ResolvedMention } from "./chat-api";

/** Where clicking a chat unfurl card should take you. Null for types with no detail page to jump to. */
export function entityHref(mention: ResolvedMention): string | null {
  switch (mention.type) {
    case "investor":
      return `/investors?investor=${mention.id}`;
    case "deal":
      return `/pipeline?deal=${mention.id}`;
    case "task":
      return `/pipeline?deal=${mention.pipelineId}&tab=tasks`;
    case "round":
      return `/fundraising?round=${mention.id}`;
    case "document":
      return `/documents?document=${mention.id}`;
    case "member":
      return null;
  }
}
