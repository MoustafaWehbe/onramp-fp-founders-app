import type { Request, Response } from "express";
import { asyncHandler } from "../utils/errors";
import { notificationService } from "../services/notification.service";
import { notificationBus } from "../events/notification-bus";
import type { RealtimeEvent } from "../events/realtime-bus";
import type { ListNotificationsQuery } from "../validators/notification.schemas";

/** Browsers reconnect an EventSource on their own; this paces the retries. */
const RETRY_MS = 5_000;

/**
 * Proxies and load balancers hang up on a connection that goes quiet. A comment
 * frame every 25s is invisible to EventSource but keeps the socket warm.
 */
const HEARTBEAT_MS = 25_000;

export const notificationController = {
  /**
   * Server-sent events, chosen over WebSockets because the traffic is entirely
   * server → client: it rides ordinary HTTP, so the existing cookie auth and
   * trust-proxy setup apply unchanged, and the browser handles reconnection.
   *
   * Despite the route name, this stream carries every RealtimeEvent for the
   * signed-in user, chat included — see events/realtime-bus.ts. Multiplexing
   * onto the one connection this endpoint already opens avoids a second
   * EventSource per tab; an unrecognized `event:` name is simply ignored by
   * whichever listeners haven't been added for it yet.
   */
  stream: (req: Request, res: Response): void => {
    const userId = req.user!.userId;

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // nginx buffers proxied responses by default, which would hold every
      // event back until the buffer filled — i.e. forever, on a quiet stream.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    res.write(`retry: ${RETRY_MS}\n\n`);
    // An immediate frame proves the pipe is open before anything happens.
    res.write(`event: ready\ndata: {}\n\n`);

    const send = (event: RealtimeEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = notificationBus.subscribe(userId, send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on("close", close);
    res.on("error", close);
  },

  list: asyncHandler(async (req, res) => {
    const { limit, unread } = req.query as unknown as ListNotificationsQuery;
    const { items, unreadCount } = await notificationService.list(req.user!.userId, {
      limit,
      unreadOnly: unread,
    });

    res.json({ data: items, meta: { unreadCount } });
  }),

  markRead: asyncHandler(async (req, res) => {
    await notificationService.markRead(req.params.notificationId as string, req.user!.userId);
    res.status(204).send();
  }),

  markAllRead: asyncHandler(async (req, res) => {
    const updated = await notificationService.markAllRead(req.user!.userId);
    res.json({ data: { updated } });
  }),
};
