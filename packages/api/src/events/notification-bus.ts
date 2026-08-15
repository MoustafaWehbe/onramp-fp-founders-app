/**
 * Backward-compatible name for the notification half of the realtime bus.
 *
 * The bus itself now lives in realtime-bus.ts and also carries chat events —
 * see that file for why. This module keeps the old import path and type name
 * working so every existing call site (notification.service.ts,
 * notification.controller.ts, and their tests) needed no changes.
 */
export { realtimeBus as notificationBus } from "./realtime-bus";
export type { NotificationEvent } from "./realtime-bus";
