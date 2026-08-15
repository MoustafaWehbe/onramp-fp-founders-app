import { prisma } from "../db/prisma";
import { googleConnectionService } from "./google-connection.service";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// A safety bound, not a Google limit. Bootstrapping a sync token requires
// walking the *entire* calendar once with no time bound (see fetchAllEvents),
// so this needs real headroom 40 pages * 250 is 10,000 events, comfortably
// past what most personal calendars accumulate in their whole history. A
// calendar that exceeds it never completes the bootstrap walk in one cron
// tick; each tick restarts the walk from page one rather than resuming,
// since page-level position isn't persisted. Known limitation, not solved
// here worth revisiting if it turns out to matter for a real founder.
const MAX_PAGES_PER_SYNC = 40;
const PAGE_SIZE = 250;

// How far back a meeting is still worth logging. Applied per-event after the
// fetch, not as a query filter Google won't hand back a sync token if the
// query is time-bounded (see fetchAllEvents), so this is the only place a
// backfill window can be enforced. A founder connecting today cares about
// recent context, not a decade of old meetings.
const RECENCY_WINDOW_DAYS = 90;

interface GoogleEventAttendee {
  email?: string;
  responseStatus?: string;
  self?: boolean;
}

interface GoogleCalendarEvent {
  id: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: GoogleEventAttendee[];
}

interface GoogleEventsPage {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export class CalendarApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function fetchEventsPage(
  accessToken: string,
  params: URLSearchParams,
): Promise<GoogleEventsPage> {
  const res = await fetch(`${CALENDAR_API_BASE}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CalendarApiError(res.status, `Google Calendar API ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as GoogleEventsPage;
}

/**
 * Pages through events.list. Deliberately never sends `timeMin`/`orderBy`, on
 * the bootstrap walk or any other: verified live against a real calendar that
 * Google only returns `nextSyncToken` the thing that makes every later sync
 * incremental instead of a full re-walk when the query carries no time
 * bound at all. Adding `timeMin` "to keep the bootstrap walk small" silently
 * gets a listing back with no usable cursor, forcing a full walk forever.
 * The 90-day recency window is enforced per-event in the caller instead, once
 * events are already in hand.
 *
 * `complete` distinguishes "reached the real end, nextSyncToken is trustworthy"
 * from "hit the page cap mid-walk" the caller must not persist a sync token
 * from an incomplete pass, or it would silently drop whatever was left unread.
 */
async function fetchAllEvents(
  accessToken: string,
  storedSyncToken: string | null,
): Promise<{
  events: GoogleCalendarEvent[];
  nextSyncToken: string | null;
  tokenExpired: boolean;
  complete: boolean;
}> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
    const params = new URLSearchParams({ singleEvents: "true", maxResults: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    if (storedSyncToken) params.set("syncToken", storedSyncToken);

    let result: GoogleEventsPage;
    try {
      result = await fetchEventsPage(accessToken, params);
    } catch (err) {
      if (err instanceof CalendarApiError && err.status === 410) {
        return { events, nextSyncToken: null, tokenExpired: true, complete: false };
      }
      throw err;
    }

    events.push(...(result.items ?? []));
    if (result.nextSyncToken) nextSyncToken = result.nextSyncToken;
    if (!result.nextPageToken) {
      return { events, nextSyncToken, tokenExpired: false, complete: true };
    }
    pageToken = result.nextPageToken;
  }

  // Capped before Google told us we were done treat as a normal, resumable
  // partial pass rather than an error.
  return { events, nextSyncToken: null, tokenExpired: false, complete: false };
}

function truncate(value: string | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export interface SyncStats {
  created: number;
  updated: number;
  retracted: number;
  skipped: number;
}

const EMPTY_STATS: SyncStats = { created: 0, updated: 0, retracted: 0, skipped: 0 };

export class CalendarSyncService {
  /**
   * Syncs one user's calendar into every active startup they belong to. A
   * no-op (not an error) when there's no connection, the connection isn't
   * active, or the founder paused calendar sync specifically.
   */
  async syncUserCalendar(userId: string): Promise<SyncStats> {
    const connection = await prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection || connection.status !== "active" || !connection.calendarSyncEnabled) {
      return EMPTY_STATS;
    }

    const memberships = await prisma.startupMember.findMany({
      where: { userId, status: "active" },
      select: { startupId: true },
    });
    if (memberships.length === 0) return EMPTY_STATS;
    const startupIds = memberships.map((m) => m.startupId);

    let accessToken: string;
    try {
      accessToken = await googleConnectionService.getValidAccessToken(userId);
    } catch (err) {
      // getValidAccessToken already flips the connection to needs_reauth on
      // invalid_grant this just records what actually happened for support.
      await prisma.googleConnection.update({
        where: { userId },
        data: { lastError: err instanceof Error ? err.message : "access token error" },
      });
      throw err;
    }

    const { events, nextSyncToken, tokenExpired, complete } = await fetchAllEvents(
      accessToken,
      connection.calendarSyncToken,
    );

    if (tokenExpired) {
      // Google expired our cursor. Clearing it forces a fresh bounded backfill
      // next cycle instead of failing forever on an unusable token.
      await prisma.googleConnection.update({
        where: { userId },
        data: { calendarSyncToken: null, lastError: "sync_token_expired" },
      });
      return EMPTY_STATS;
    }

    const stats: SyncStats = { ...EMPTY_STATS };
    const now = Date.now();

    for (const event of events) {
      if (event.status === "cancelled") {
        const { count } = await prisma.interactionLog.deleteMany({
          where: { externalId: event.id, source: "google_calendar", editedByUser: false },
        });
        stats.retracted += count;
        continue;
      }

      // All-day events carry `start.date`/`end.date` instead of `dateTime` —
      // excluded per plan, they're not the kind of "meeting" this feature means.
      if (!event.start?.dateTime || !event.end?.dateTime) {
        stats.skipped++;
        continue;
      }
      // Only a meeting that actually happened gets logged one still on the
      // calendar could still move or be cancelled before it occurs.
      const endMs = new Date(event.end.dateTime).getTime();
      if (endMs > now) {
        stats.skipped++;
        continue;
      }
      // The bootstrap walk necessarily sees a founder's entire calendar
      // history (see fetchAllEvents) this is what actually keeps decade-old
      // meetings off the timeline, since the query itself can't.
      if (endMs < now - RECENCY_WINDOW_DAYS * 86_400_000) {
        stats.skipped++;
        continue;
      }
      if (event.attendees?.some((a) => a.self && a.responseStatus === "declined")) {
        stats.skipped++;
        continue;
      }

      const attendeeEmails = (event.attendees ?? [])
        .map((a) => a.email?.trim())
        .filter((email): email is string => Boolean(email));
      if (attendeeEmails.length === 0) {
        stats.skipped++;
        continue;
      }

      for (const startupId of startupIds) {
        const investors = await prisma.startupInvestor.findMany({
          where: {
            startupId,
            OR: attendeeEmails.map((email) => ({
              email: { equals: email, mode: "insensitive" as const },
            })),
          },
          select: { id: true },
        });

        for (const investor of investors) {
          const outcome = await this.upsertMeetingLog(startupId, investor.id, userId, event);
          if (outcome === "created") stats.created++;
          else if (outcome === "updated") stats.updated++;
        }
      }
    }

    await prisma.googleConnection.update({
      where: { userId },
      data: {
        // Only a *complete* pass earns a new cursor a capped one leaves the
        // old cursor in place so the same delta is retried next cycle.
        ...(complete && { calendarSyncToken: nextSyncToken }),
        lastSyncedAt: new Date(),
        lastError: complete ? null : "sync_incomplete_will_resume",
      },
    });

    return stats;
  }

  /**
   * Never persists an event that matched no investor Phase 2's privacy
   * decision is that only matched events are worth storing at all, so this is
   * the only place a row gets written, and only after a match is confirmed.
   */
  private async upsertMeetingLog(
    startupId: string,
    startupInvestorId: string,
    userId: string,
    event: GoogleCalendarEvent,
  ): Promise<"created" | "updated" | "unchanged"> {
    const deal = await prisma.pipeline.findFirst({
      where: { startupId, startupInvestorId, round: { status: "active" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const fields = {
      pipelineId: deal?.id ?? null,
      subject: truncate(event.summary, 200) ?? "Meeting",
      description: truncate(event.description, 2000),
      interactionDate: new Date(event.start!.dateTime!),
    };

    const existing = await prisma.interactionLog.findUnique({
      where: { startupInvestorId_externalId: { startupInvestorId, externalId: event.id } },
      select: { id: true, editedByUser: true },
    });

    if (!existing) {
      await prisma.interactionLog.create({
        data: {
          startupInvestorId,
          createdBy: userId,
          type: "meeting",
          source: "google_calendar",
          externalId: event.id,
          ...fields,
        },
      });
      return "created";
    }

    // A human already edited this row a re-sync must never overwrite what
    // they wrote, even if the underlying event also changed.
    if (existing.editedByUser) return "unchanged";

    await prisma.interactionLog.update({ where: { id: existing.id }, data: fields });
    return "updated";
  }
}

export const calendarSyncService = new CalendarSyncService();
