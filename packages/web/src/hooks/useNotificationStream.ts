import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "./useAuth";
import { NOTIFICATIONS_KEY } from "./useNotifications";
import { MY_INVITES_KEY } from "./useMyInvites";

const STREAM_URL = "/api/v1/notifications/stream";

type CreatedEvent = {
  notification: { id: string; type: string; title: string; body: string | null };
};

/**
 * Keeps the notification feed live over server-sent events.
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
