import type { Request, Response } from "express";
import { asyncHandler } from "../utils/errors";
import { googleConnectionService } from "../services/google-connection.service";
import { calendarSyncService } from "../services/calendar-sync.service";
import { getAppUrl, isGoogleIntegrationEnabled } from "../config/env";
import type {
  GoogleCallbackQuery,
  CalendarSyncSettingInput,
} from "../validators/integrations.schemas";

function settingsRedirect(status: "connected" | "error", reason?: string): string {
  const url = new URL(`${getAppUrl()}/settings`);
  url.searchParams.set("integration", status);
  if (reason) url.searchParams.set("reason", reason);
  return url.toString();
}

export const integrationsController = {
  status: asyncHandler(async (req: Request, res: Response) => {
    const status = await googleConnectionService.getStatus(req.user!.userId);
    res.json({ data: { ...status, configured: isGoogleIntegrationEnabled() } });
  }),

  // A top-level navigation like the callback below (the Settings page hides
  // the button that leads here when the integration isn't configured, but a
  // stale tab or a bookmarked link can still land here directly).
  connect: asyncHandler(async (req: Request, res: Response) => {
    try {
      const url = await googleConnectionService.buildAuthUrl(req.user!.userId);
      res.redirect(url);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "CONNECT_FAILED";
      res.redirect(settingsRedirect("error", code));
    }
  }),

  /**
   * Google redirects the browser here directly — this is a page navigation,
   * not an API call, so failures redirect back into the app with a reason
   * rather than answering with a JSON error the user would never see rendered.
   */
  callback: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as GoogleCallbackQuery;

    if ("error" in query) {
      res.redirect(settingsRedirect("error", query.error));
      return;
    }

    try {
      await googleConnectionService.handleCallback(query.code, query.state);
      res.redirect(settingsRedirect("connected"));
    } catch (err) {
      const code = (err as { code?: string }).code ?? "CONNECT_FAILED";
      res.redirect(settingsRedirect("error", code));
    }
  }),

  disconnect: asyncHandler(async (req: Request, res: Response) => {
    await googleConnectionService.disconnect(req.user!.userId);
    res.status(204).send();
  }),

  setCalendarSync: asyncHandler(async (req: Request, res: Response) => {
    const { enabled } = req.body as CalendarSyncSettingInput;
    await googleConnectionService.setCalendarSyncEnabled(req.user!.userId, enabled);
    res.status(204).send();
  }),

  /** On-demand sync, for the Settings "Sync now" button — runs inline rather
   * than through the queue, since a manual click wants an immediate result,
   * not a job id to poll. */
  triggerCalendarSync: asyncHandler(async (req: Request, res: Response) => {
    const stats = await calendarSyncService.syncUserCalendar(req.user!.userId);
    res.json({ data: stats });
  }),
};
