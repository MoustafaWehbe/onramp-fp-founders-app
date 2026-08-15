import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { apiErrorMessage } from "../../../lib/api-error";
import { qk } from "../../../lib/query-keys";
import { sendMessage, searchMentionables, type MentionableItem } from "../../../lib/chat-api";
import { MENTION_TARGET_TYPES, mentionToken, type MentionTargetType } from "../../../lib/mentions";
import { MentionPicker } from "./MentionPicker";

type MentionContext = {
  /** Index of the "@" that opened the picker. */
  start: number;
  query: string;
  typeFilter?: MentionTargetType;
};

/**
 * `@` anywhere in the message opens the picker; `type:` right after it (e.g.
 * "@deal:sequ") narrows the search. Only fires after start-of-string or
 * whitespace, so "email@x.com" never triggers it.
 */
function detectMentionContext(value: string, cursor: number): MentionContext | null {
  const before = value.slice(0, cursor);
  const match = before.match(/(?:^|\s)@([a-zA-Z0-9:_-]{0,60})$/);
  if (!match) return null;

  const raw = match[1];
  const start = cursor - raw.length - 1;
  const colonIndex = raw.indexOf(":");
  if (colonIndex > 0) {
    const candidate = raw.slice(0, colonIndex);
    if ((MENTION_TARGET_TYPES as readonly string[]).includes(candidate)) {
      return { start, query: raw.slice(colonIndex + 1), typeFilter: candidate as MentionTargetType };
    }
  }
  return { start, query: raw };
}

type ComposerProps = {
  startupId: string;
  conversationId: string;
  conversationName: string;
};

export function Composer({ startupId, conversationId, conversationName }: ComposerProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [mention, setMention] = useState<MentionContext | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const nonceRef = useRef(crypto.randomUUID());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!mention) return;
    const timer = setTimeout(() => setDebouncedQuery(mention.query), 150);
    return () => clearTimeout(timer);
  }, [mention]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [debouncedQuery, mention?.typeFilter]);

  const mentionablesQuery = useQuery({
    queryKey: qk.mentionables(startupId, debouncedQuery, mention?.typeFilter ? [mention.typeFilter] : undefined),
    queryFn: () =>
      searchMentionables(startupId, {
        q: debouncedQuery,
        types: mention?.typeFilter ? [mention.typeFilter] : undefined,
      }),
    enabled: mention !== null && debouncedQuery.trim().length > 0,
  });

  const items = mention ? (mentionablesQuery.data ?? []) : [];

  const sendMutation = useMutation({
    mutationFn: () => sendMessage(startupId, conversationId, { body: body.trim(), clientNonce: nonceRef.current }),
    onSuccess: () => {
      setBody("");
      setMention(null);
      // Only rotate the nonce once the send is confirmed — an error leaves it
      // in place so retrying the same draft can't double-post.
      nonceRef.current = crypto.randomUUID();
      void queryClient.invalidateQueries({ queryKey: qk.messages(startupId, conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send that message")),
  });

  function updateMentionContext(value: string, cursor: number) {
    setMention(detectMentionContext(value, cursor));
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setBody(event.target.value);
    updateMentionContext(event.target.value, event.target.selectionStart);
  }

  function selectMention(item: MentionableItem) {
    const textarea = textareaRef.current;
    if (!mention || !textarea) return;

    const cursor = textarea.selectionStart;
    const token = mentionToken(item.type, item.id, item.label);
    const next = body.slice(0, mention.start) + token + " " + body.slice(cursor);
    setBody(next);
    setMention(null);

    const caretPosition = mention.start + token.length + 1;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caretPosition, caretPosition);
    });
  }

  function handleSend() {
    if (!body.trim() || sendMutation.isPending) return;
    sendMutation.mutate();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && items.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((i) => (i + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        selectMention(items[highlightedIndex]);
        return;
      }
    }

    if (event.key === "Escape" && mention) {
      event.preventDefault();
      setMention(null);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="relative border-t border-border/60 p-3">
      {mention && (
        <div className="absolute inset-x-3 bottom-full mb-2 z-10">
          <MentionPicker
            items={items}
            isLoading={mentionablesQuery.isFetching}
            query={mention.query}
            highlightedIndex={highlightedIndex}
            onHover={setHighlightedIndex}
            onSelect={selectMention}
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={(event) =>
            updateMentionContext(event.currentTarget.value, event.currentTarget.selectionStart)
          }
          placeholder={`Message #${conversationName} — type @ to reference an investor, deal, task, round or document`}
          rows={1}
          className="min-h-[2.5rem] resize-none py-2"
          disabled={sendMutation.isPending}
        />
        <Button
          type="button"
          size="icon"
          aria-label="Send message"
          onClick={handleSend}
          disabled={!body.trim() || sendMutation.isPending}
          className="shrink-0"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
