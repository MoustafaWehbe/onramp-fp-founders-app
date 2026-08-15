import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "./useAuth";
import { useAppStore } from "../lib/app-store";
import { NOTIFICATIONS_KEY } from "./useNotifications";
import { MY_INVITES_KEY } from "./useMyInvites";
import { qk } from "../lib/query-keys";

const STREAM_URL = "/api/v1/notifications/stream";

type CreatedEvent = {
  notification: { id: string; type: string; title: string; body: string | null };
};

type ChatMessageCreatedEvent = { conversationId: string };

/**
 * Keeps the notification feed *and* team chat live over one shared
 * server-sent events connection.
 *
 * Despite the endpoint's name, the server multiplexes every realtime event
 * for the signed-in user onto this one stream — see the comment on
 * notificationController.stream — so chat listens here too rather than
 * opening a second EventSource.
 *
 * The stream is a signal, not a data source: every event just invalidates the
 * queries and lets them refetch. Trying to splice pushed payloads into the
 * cache would mean two code paths that can disagree, for no gain — the refetch
 * is one request against an endpoint that already exists.
 *
 * Mount once, high in the tree.
 */
export function useNotificationStream() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  // Chat is startup-scoped, so the active workspace decides which
  // conversations query a chat event should invalidate. Read through a ref
  // rather than a hook dependency — switching workspaces must not tear down
  // and reopen the one live connection the whole app shares.
  const activeStartupId = useAppStore((s) => s.preferredStartupId);
  const activeStartupIdRef = useRef(activeStartupId);
  activeStartupIdRef.current = activeStartupId;

  useEffect(() => {
    if (!userId) return;

    // Same origin in every environment — dev goes through the Vite proxy — so
    // the HttpOnly session cookie rides along without withCredentials.
    const source = new EventSource(STREAM_URL);

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_INVITES_KEY });
    };

    source.addEventListener("notification.created", (event) => {
      refresh();

      try {
        const { notification } = JSON.parse((event as MessageEvent).data) as CreatedEvent;
        toast(notification.title, { description: notification.body ?? undefined });
      } catch {
        // A malformed frame still means something changed; the refetch above
        // has already been queued, so there is nothing to recover.
      }
    });

    source.addEventListener("notifications.changed", refresh);

    source.addEventListener("chat.message.created", (event) => {
      const startupId = activeStartupIdRef.current;
      if (!startupId) return;

      try {
        const { conversationId } = JSON.parse(
          (event as MessageEvent).data,
        ) as ChatMessageCreatedEvent;
        void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
        void queryClient.invalidateQueries({
          queryKey: qk.messages(startupId, conversationId),
        });
      } catch {
        // Same fallback as above — nothing more specific to recover with.
      }
    });

    source.addEventListener("chat.conversation.changed", () => {
      const startupId = activeStartupIdRef.current;
      if (startupId) void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
    });

    // EventSource reconnects on its own. The one case it cannot fix is an
    // expired access token — the reconnect 401s — but any ordinary request
    // refreshes the cookie through the axios interceptor, and the next
    // reconnect then succeeds.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        console.warn("[notifications] stream closed by the server");
      }
    };

    return () => source.close();
  }, [userId, queryClient]);
}
