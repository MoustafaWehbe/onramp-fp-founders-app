import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { googleConnectionService } from "./google-connection.service";

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DESCRIPTION_MAX = 2000;

export type MeetingType = "call" | "meeting";

const TYPE_LABEL: Record<MeetingType, string> = { call: "Call", meeting: "Meeting" };

export interface ScheduleMeetingInput {
  pipelineId?: string;
  type: MeetingType;
  startDateTime: Date;
  durationMinutes: number;
  subject?: string;
  description?: string;
}

export interface ScheduleMeetingResult {
  eventId: string;
  htmlLink: string;
  /** False only if the event was created at Google but the log write had to
   *  be deferred — the event itself is never rolled back or reported as failed. */
  logCreated: boolean;
}

export class CalendarEventService {
  async scheduleMeeting(
    startupId: string,
    investorId: string,
    userId: string,
    input: ScheduleMeetingInput,
  ): Promise<ScheduleMeetingResult> {
    const investor = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: investorId } },
      select: { id: true, email: true, fullName: true },
    });
    if (!investor) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");
    // Calendar invites need an attendee address, and accepting a caller-supplied
    // one would let this endpoint invite anyone, not just this investor.
    if (!investor.email) {
      throw createError("This investor has no email on file", 422, "INVESTOR_EMAIL_MISSING");
    }

    if (input.pipelineId) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { startupId_id: { startupId, id: input.pipelineId } },
        select: { startupInvestorId: true },
      });
      if (!pipeline || pipeline.startupInvestorId !== investor.id) {
        throw createError(
          "Pipeline entry does not belong to this investor contact",
          422,
          "PIPELINE_MISMATCH",
        );
      }
    }

    const pipelineId = input.pipelineId ?? (await this.resolveActiveDeal(startupId, investor.id));

    const connection = await prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection || connection.status !== "active") {
      throw createError("Google account is not connected", 409, "GOOGLE_NOT_CONNECTED");
    }

    const accessToken = await googleConnectionService.getValidAccessToken(userId);

    const start = input.startDateTime;
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    const subject = input.subject?.trim() || `${TYPE_LABEL[input.type]} with ${investor.fullName}`;

    // sendUpdates=all is what actually gets the investor an invite email —
    // without it Google creates the event silently and no one but the
    // founder ever sees it.
    const res = await fetch(`${CALENDAR_EVENTS_URL}?sendUpdates=all`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: subject,
        description: input.description || undefined,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        attendees: [{ email: investor.email }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // A connection made before the write scope existed still has a valid
      // grant — it just lacks this permission, so it won't hit the
      // invalid_grant path getValidAccessToken already handles.
      if (res.status === 403 && /insufficient/i.test(detail)) {
        throw createError(
          "Google needs a fresh permission grant to create calendar events — reconnect your account in Settings.",
          409,
          "GOOGLE_INSUFFICIENT_SCOPE",
        );
      }
      throw createError(
        `Google rejected the request (${res.status}): ${detail.slice(0, 300)}`,
        502,
        "CALENDAR_EVENT_FAILED",
      );
    }

    const created = (await res.json()) as { id: string; htmlLink: string };

    // The event is already created and the investor already invited at this
    // point — a log-write failure here must never be reported as a failed
    // schedule. Unlike Gmail send, this has no dedicated retry queue: the
    // normal calendar-sync cron will pick the event up on its own once the
    // meeting time has passed (it matches by attendee email and dedupes on
    // this same externalId), so nothing is lost, just delayed until then.
    let logCreated = true;
    try {
      await prisma.interactionLog.create({
        data: {
          startupInvestorId: investor.id,
          pipelineId: pipelineId ?? null,
          createdBy: userId,
          type: input.type,
          source: "google_calendar",
          externalId: created.id,
          subject,
          description: input.description
            ? input.description.length > DESCRIPTION_MAX
              ? input.description.slice(0, DESCRIPTION_MAX)
              : input.description
            : null,
          interactionDate: start,
        },
      });
    } catch (err) {
      console.error(
        "[calendar-event] log write failed after event creation, will backfill on next sync:",
        err,
      );
      logCreated = false;
    }

    return { eventId: created.id, htmlLink: created.htmlLink, logCreated };
  }

  private async resolveActiveDeal(
    startupId: string,
    startupInvestorId: string,
  ): Promise<string | null> {
    const deal = await prisma.pipeline.findFirst({
      where: { startupId, startupInvestorId, round: { status: "active" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return deal?.id ?? null;
  }
}

export const calendarEventService = new CalendarEventService();
