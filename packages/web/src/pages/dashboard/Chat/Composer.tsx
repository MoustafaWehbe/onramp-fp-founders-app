import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, ListChecks, Paperclip, SendHorizontal, Share2, Users, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { apiErrorMessage } from "../../../lib/api-error";
import { qk } from "../../../lib/query-keys";
import { usePermissions } from "../../../hooks/usePermissions";
import { useAuth } from "../../../hooks/useAuth";
import { useWorkspace } from "../../../hooks/useWorkspace";
import {
  sendMessage,
  searchMentionables,
  pingTyping,
  type MentionableItem,
  type Message,
  type SendMessageInput,
} from "../../../lib/chat-api";
import { readChatDraft, writeChatDraft } from "../../../lib/chat-drafts";
import {
  insertOptimisticMessage,
  replaceOptimisticMessage,
  setOptimisticDeliveryState,
} from "../../../lib/chat-message-cache";
import {
  expandComposerMentions,
  mentionDisplay,
  mentionToken,
  type ComposerMention,
  type MentionTargetType,
} from "../../../lib/mentions";
import { MentionPicker } from "./MentionPicker";
import { EntityPickerMenu } from "./EntityPickerMenu";

type MentionContext = {
  /** Index of the "@" that opened the picker. */
  start: number;
  query: string;
};

/**
 * `@` anywhere in the message opens the picker. Only fires after
 * start-of-string or whitespace, so "email@x.com" never triggers it.
 * Teammates only referencing an investor, deal, task or round goes through
 * the Share button instead, see `SHARE_TYPES` below.
 */
function detectMentionContext(value: string, cursor: number): MentionContext | null {
  const before = value.slice(0, cursor);
  const match = before.match(/(?:^|\s)@([a-zA-Z0-9_-]{0,60})$/);
  if (!match) return null;

  const raw = match[1];
  const start = cursor - raw.length - 1;
  return { start, query: raw };
}

const SHARE_TYPES: {
  type: MentionTargetType;
  label: string;
  icon: typeof Briefcase;
  /** The read permission that gates offering this type at all mirrors TYPE_PERMISSION_RESOURCE server-side. */
  resource: "pipeline" | "financial";
}[] = [
  { type: "investor", label: "Investor", icon: Users, resource: "pipeline" },
  { type: "deal", label: "Deal", icon: Briefcase, resource: "pipeline" },
  { type: "task", label: "Task", icon: ListChecks, resource: "pipeline" },
  { type: "round", label: "Round", icon: Wallet, resource: "financial" },
];

/** Minimum gap between typing pings pinging on every keystroke would flood the SSE fan-out for no UX gain. */
const TYPING_PING_INTERVAL_MS = 2500;

type ComposerProps = {
  startupId: string;
  conversationId: string;
  conversationName: string;
  /** Set to post a thread reply instead of a top-level message. */
  parentMessageId?: string;
  placeholder?: string;
  /** Fires after a successful send, in addition to the composer's own cache invalidation ThreadDialog uses this to refresh its reply list. */
  onSent?: () => void;
};

export function Composer({
  startupId,
  conversationId,
  parentMessageId,
  placeholder,
  onSent,
}: ComposerProps) {
  const queryClient = useQueryClient();
  const initialDraftRef = useRef(readChatDraft(startupId, conversationId, parentMessageId));
  const [body, setBody] = useState(initialDraftRef.current?.body ?? "");
  /** Maps friendly `@Name` aliases in the draft to wire `@[Name](type:id)` tokens for send. */
  const [pendingMentions, setPendingMentions] = useState<ComposerMention[]>(
    initialDraftRef.current?.pendingMentions ?? [],
  );
  const [mention, setMention] = useState<MentionContext | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [attachedDocs, setAttachedDocs] = useState<MentionableItem[]>(
    initialDraftRef.current?.attachedDocs ?? [],
  );
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [shareType, setShareType] = useState<MentionTargetType | null>(null);
  const { can } = usePermissions();
  const { user } = useAuth();
  const { activeStartup } = useWorkspace();
  const nonceRef = useRef(initialDraftRef.current?.clientNonce ?? crypto.randomUUID());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingPingRef = useRef(0);

  useEffect(() => {
    if (!mention) return;
    const timer = setTimeout(() => setDebouncedQuery(mention.query), 150);
    return () => clearTimeout(timer);
  }, [mention]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [debouncedQuery]);

  useEffect(() => {
    writeChatDraft(startupId, conversationId, parentMessageId, {
      body,
      pendingMentions,
      attachedDocs,
      clientNonce: nonceRef.current,
    });
  }, [startupId, conversationId, parentMessageId, body, pendingMentions, attachedDocs]);

  const mentionablesQuery = useQuery({
    queryKey: qk.mentionables(startupId, debouncedQuery, ["member"]),
    queryFn: () => searchMentionables(startupId, { q: debouncedQuery, types: ["member"] }),
    enabled: mention !== null && debouncedQuery.trim().length > 0,
  });

  const items = mention ? (mentionablesQuery.data ?? []) : [];

  const sendMutation = useMutation({
    mutationFn: (input: SendMessageInput) => sendMessage(startupId, conversationId, input),
    onMutate: (input) => {
      const optimistic: Message = {
        id: `optimistic:${input.clientNonce}`,
        startupId,
        conversationId,
        seq: `optimistic:${Date.now()}`,
        senderId: activeStartup?.member.id ?? null,
        sender: user
          ? {
              id: activeStartup?.member.id ?? "current-member",
              firstName: user.firstName,
              lastName: user.lastName,
              avatarUrl: user.avatarUrl,
            }
          : null,
        body: input.body,
        parentMessageId: input.parentMessageId ?? null,
        replyCount: 0,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        reactions: [],
        attachments: attachedDocs.map((doc) => ({
          documentId: doc.id,
          title: doc.label,
          documentType: doc.sublabel ?? "document",
        })),
        deliveryState: "sending",
        clientNonce: input.clientNonce,
      };
      insertOptimisticMessage(queryClient, startupId, optimistic);
      setBody("");
      setPendingMentions([]);
      setMention(null);
      setAttachedDocs([]);
      nonceRef.current = crypto.randomUUID();
      return { optimistic };
    },
    onSuccess: (delivered, _input, context) => {
      replaceOptimisticMessage(queryClient, startupId, context.optimistic, delivered);
      void queryClient.invalidateQueries({ queryKey: qk.messages(startupId, conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
      onSent?.();
    },
    onError: (err, _input, context) => {
      if (context) setOptimisticDeliveryState(queryClient, startupId, context.optimistic, "failed");
      toast.error(apiErrorMessage(err, "Message failed to send. Retry it from the conversation."));
    },
  });

  function updateMentionContext(value: string, cursor: number) {
    setMention(detectMentionContext(value, cursor));
  }

  function pingTypingThrottled() {
    const now = Date.now();
    if (now - lastTypingPingRef.current < TYPING_PING_INTERVAL_MS) return;
    lastTypingPingRef.current = now;
    void pingTyping(startupId, conversationId).catch(() => {
      // A missed typing ping is invisible by design nothing to recover.
    });
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setBody(value);
    // Drop aliases the user edited or deleted so we never hydrate a stale pick.
    setPendingMentions((prev) => prev.filter((entry) => value.includes(entry.display)));
    updateMentionContext(value, event.target.selectionStart);
    if (value.trim().length > 0) pingTypingThrottled();
  }

  function selectMention(item: MentionableItem) {
    const textarea = textareaRef.current;
    if (!mention || !textarea) return;

    const cursor = textarea.selectionStart;
    const display = mentionDisplay(item.label);
    const token = mentionToken(item.type, item.id, item.label);
    const next = body.slice(0, mention.start) + display + " " + body.slice(cursor);
    setBody(next);
    setPendingMentions((prev) => [...prev, { display, token }]);
    setMention(null);

    const caretPosition = mention.start + display.length + 1;
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

  /** A Share-button pick is appended to the draft rather than spliced at the caret it's an attachment-style reference, not something typed mid-sentence. */
  function appendMentionToken(item: MentionableItem) {
    const textarea = textareaRef.current;
    const display = mentionDisplay(item.label);
    const token = mentionToken(item.type, item.id, item.label);
    const separator = body.length > 0 && !body.endsWith(" ") ? " " : "";
    const next = `${body}${separator}${display} `;
    setBody(next);
    setPendingMentions((prev) => [...prev, { display, token }]);
    setShareType(null);

    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(next.length, next.length);
    });
  }

  function handleSend() {
    if (!body.trim() || sendMutation.isPending) return;
    sendMutation.mutate({
      body: expandComposerMentions(body, pendingMentions).trim(),
      clientNonce: nonceRef.current,
      parentMessageId,
      documentIds: attachedDocs.length > 0 ? attachedDocs.map((doc) => doc.id) : undefined,
    });
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
          <EntityPickerMenu
            startupId={startupId}
            types={["document"]}
            icon={Paperclip}
            searchPlaceholder="Search documents…"
            idleHint="Type to search the document vault."
            excludeIds={attachedDocs.map((d) => d.id)}
            onSelect={selectAttachment}
          />
        </div>
      )}

      {shareType && (
        <div className="absolute bottom-full left-12 z-10 mb-2">
          {(() => {
            const shareDef = SHARE_TYPES.find((s) => s.type === shareType)!;
            return (
              <EntityPickerMenu
                startupId={startupId}
                types={[shareType]}
                icon={shareDef.icon}
                searchPlaceholder={`Search ${shareDef.label.toLowerCase()}s…`}
                idleHint={`Type to search ${shareDef.label.toLowerCase()}s.`}
                onSelect={appendMentionToken}
              />
            );
          })()}
        </div>
      )}

      {attachedDocs.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachedDocs.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface/40 py-1 pl-2.5 pr-1.5 text-xs"
            >
              <span className="max-w-40 truncate font-medium">{doc.label}</span>
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
          onClick={() => {
            setShareType(null);
            setAttachMenuOpen((v) => !v);
          }}
          className="h-9 w-9 shrink-0"
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        {SHARE_TYPES.some((s) => can(s.resource, "read")) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Share an investor, deal, task or round"
                onClick={() => setAttachMenuOpen(false)}
                className="h-9 w-9 shrink-0"
              >
                <Share2 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {SHARE_TYPES.filter((s) => can(s.resource, "read")).map((s) => (
                <DropdownMenuItem key={s.type} onSelect={() => setShareType(s.type)}>
                  <s.icon className="h-4 w-4" />
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={(event) =>
            updateMentionContext(event.currentTarget.value, event.currentTarget.selectionStart)
          }
          placeholder={placeholder ?? `@ to mention a teammate`}
          rows={1}
          className="min-h-10 resize-none py-2"
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
