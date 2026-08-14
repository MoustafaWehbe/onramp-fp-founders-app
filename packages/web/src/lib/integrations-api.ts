import { apiClient } from "./api-client";

export type GoogleConnectionStatus = {
  connected: boolean;
  googleEmail?: string;
  scopes?: string[];
  status?: "active" | "needs_reauth" | "revoked";
  calendarSyncEnabled?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  /** Whether this deployment has the integration set up at all — see config/env.ts. */
  configured: boolean;
};

export type CalendarSyncStats = {
  created: number;
  updated: number;
  retracted: number;
  skipped: number;
};

export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  const { data } = await apiClient.get<{ data: GoogleConnectionStatus }>(
    "/integrations/google/status",
  );
  return data.data;
}

/**
 * A full-page navigation, not a fetch — Google's consent screen has to be the
 * top-level document, and the callback lands back on /settings with the
 * result already applied server-side.
 */
export function connectGoogleAccount(): void {
  window.location.href = "/api/v1/integrations/google/connect";
}

export async function disconnectGoogleAccount(): Promise<void> {
  await apiClient.post("/integrations/google/disconnect");
}

export async function setCalendarSyncEnabled(enabled: boolean): Promise<void> {
  await apiClient.patch("/integrations/google/calendar-sync", { enabled });
}

export async function triggerCalendarSync(): Promise<CalendarSyncStats> {
  const { data } = await apiClient.post<{ data: CalendarSyncStats }>(
    "/integrations/google/calendar-sync/trigger",
  );
  return data.data;
}
