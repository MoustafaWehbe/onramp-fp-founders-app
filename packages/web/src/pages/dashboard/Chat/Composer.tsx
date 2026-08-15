import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { apiErrorMessage } from "../../../lib/api-error";
import { qk } from "../../../lib/query-keys";
import { sendMessage, searchMentionables, pingTyping, type MentionableItem } from "../../../lib/chat-api";
import { MENTION_TARGET_TYPES, mentionToken, type MentionTargetType } from "../../../lib/mentions";
import { MentionPicker } from "./MentionPicker";
import { AttachDocumentMenu } from "./AttachDocumentMenu";

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

/** Minimum gap between typing pings — pinging on every keystroke would flood the SSE fan-out for no UX gain. */
const TYPING_PING_INTERVAL_MS = 2500;

type ComposerProps = {
  startupId: string;
  conversationId: string;
  conversationName: string;
  /** Set to post a thread reply instead of a top-level message. */
  parentMessageId?: string;
  placeholder?: string;
  /** Fires after a successful send, in addition to the composer's own cache invalidation — ThreadDialog uses this to refresh its reply list. */
  onSent?: () => void;
};

export function Composer({
  startupId,
  conversationId,
  conversationName,
  parentMessageId,
  placeholder,
  onSent,
}: ComposerProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [mention, setMention] = useState<MentionContext | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [attachedDocs, setAttachedDocs] = useState<MentionableItem[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const nonceRef = useRef(crypto.randomUUID());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingPingRef = useRef(0);

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
    mutationFn: () =>
      sendMessage(startupId, conversationId, {
        body: body.trim(),
        clientNonce: nonceRef.current,
        parentMessageId,
        documentIds: attachedDocs.length > 0 ? attachedDocs.map((d) => d.id) : undefined,
      }),
    onSuccess: () => {
      setBody("");
      setMention(null);
      setAttachedDocs([]);
      // Only rotate the nonce once the send is confirmed — an error leaves it
      // in place so retrying the same draft can't double-post.
      nonceRef.current = crypto.randomUUID();
      void queryClient.invalidateQueries({ queryKey: qk.messages(startupId, conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
      onSent?.();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send that message")),
  });

  function updateMentionContext(value: string, cursor: number) {
    setMention(detectMentionContext(value, cursor));
  }

  function pingTypingThrottled() {
    const now = Date.now();
    if (now - lastTypingPingRef.current < TYPING_PING_INTERVAL_MS) return;
    lastTypingPingRef.current = now;
    void pingTyping(startupId, conversationId).catch(() => {
      // A missed typing ping is invisible by design — nothing to recover.
    });
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setBody(event.target.value);
    updateMentionContext(event.target.value, event.target.selectionStart);
    if (event.target.value.trim().length > 0) pingTypingThrottled();
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

  function selectAttachment(item: MentionableItem) {
    setAttachedDocs((prev) => (prev.some((d) => d.id === item.id) ? prev : [...prev, item]));
    setAttachMenuOpen(false);
  }

  function removeAttachment(id: string) {
    setAttachedDocs((prev) => prev.filter((d) => d.id !== id));
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

      {attachMenuOpen && (
        <div className="absolute bottom-full left-3 z-10 mb-2">
          <AttachDocumentMenu
            startupId={startupId}
            excludeIds={attachedDocs.map((d) => d.id)}
            onSelect={selectAttachment}
          />
        </div>
      )}

      {attachedDocs.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachedDocs.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface/40 py-1 pl-2.5 pr-1.5 text-xs"
            >
              <span className="max-w-[10rem] truncate font-medium">{doc.label}</span>
              <button
                type="button"
                aria-label={`Remove ${doc.label}`}
                onClick={() => removeAttachment(doc.id)}
                className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Attach a document"
          onClick={() => setAttachMenuOpen((v) => !v)}
          className="h-9 w-9 shrink-0"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={(event) =>
            updateMentionContext(event.currentTarget.value, event.currentTarget.selectionStart)
          }
          placeholder={placeholder ?? `Message #${conversationName} — type @ to reference an investor, deal, task, round or document`}
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
