import { asyncHandler } from "../utils/errors";
import { notificationService } from "../services/notification.service";
import type { ListNotificationsQuery } from "../validators/notification.schemas";

export const notificationController = {
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
