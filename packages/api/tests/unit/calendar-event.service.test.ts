import { CalendarEventService } from "../../src/services/calendar-event.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupInvestor: { findUnique: jest.fn() },
    pipeline: { findUnique: jest.fn(), findFirst: jest.fn() },
    googleConnection: { findUnique: jest.fn() },
    interactionLog: { create: jest.fn() },
  },
}));

jest.mock("../../src/services/google-connection.service", () => ({
  googleConnectionService: { getValidAccessToken: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { googleConnectionService } from "../../src/services/google-connection.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetValidAccessToken = googleConnectionService.getValidAccessToken as jest.Mock;
const service = new CalendarEventService();

const STARTUP_ID = "startup-1";
const INVESTOR_ID = "investor-1";
const USER_ID = "user-1";
const PIPELINE_ID = "pipeline-1";

const INVESTOR = { id: INVESTOR_ID, email: "investor@example.com", fullName: "Elena Fischer" };
const CONNECTION = { status: "active" };

const START = new Date("2026-09-01T14:00:00.000Z");

function mockEventResponse(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  });
}

function lastFetchBody(): {
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees: { email: string }[];
} {
  const call = (global.fetch as jest.Mock).mock.calls[0];
  return JSON.parse(call[1].body);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  mockPrisma.startupInvestor.findUnique.mockResolvedValue(INVESTOR as never);
  mockPrisma.pipeline.findFirst.mockResolvedValue(null);
  mockPrisma.googleConnection.findUnique.mockResolvedValue(CONNECTION as never);
  mockGetValidAccessToken.mockResolvedValue("access-token");
  mockPrisma.interactionLog.create.mockResolvedValue({} as never);
});

describe("scheduleMeeting — guard clauses", () => {
  it("throws INVESTOR_NOT_FOUND when the investor doesn't belong to the startup", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue(null);
    await expect(
      service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
        type: "call",
        startDateTime: START,
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({ code: "INVESTOR_NOT_FOUND" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws INVESTOR_EMAIL_MISSING rather than accepting any other attendee", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue({
      id: INVESTOR_ID,
      email: null,
      fullName: "Elena Fischer",
    } as never);
    await expect(
      service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
        type: "call",
        startDateTime: START,
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({ code: "INVESTOR_EMAIL_MISSING" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws PIPELINE_MISMATCH when the given deal belongs to a different contact", async () => {
    mockPrisma.pipeline.findUnique.mockResolvedValue({ startupInvestorId: "someone-else" } as never);
    await expect(
      service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
        pipelineId: PIPELINE_ID,
        type: "call",
        startDateTime: START,
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({ code: "PIPELINE_MISMATCH" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws GOOGLE_NOT_CONNECTED when there is no active connection", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(null);
    await expect(
      service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
        type: "call",
        startDateTime: START,
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_NOT_CONNECTED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("scheduleMeeting — the event request", () => {
  it("invites only the investor's stored email", async () => {
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });

    await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      type: "meeting",
      startDateTime: START,
      durationMinutes: 30,
    });

    const body = lastFetchBody();
    expect(body.attendees).toEqual([{ email: "investor@example.com" }]);
  });

  it("computes the end time from the requested duration", async () => {
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });

    await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      type: "call",
      startDateTime: START,
      durationMinutes: 45,
    });

    const body = lastFetchBody();
    expect(body.start.dateTime).toBe(START.toISOString());
    expect(body.end.dateTime).toBe(new Date(START.getTime() + 45 * 60_000).toISOString());
  });

  it("defaults the summary from the type and investor name when no subject is given", async () => {
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });

    await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      type: "call",
      startDateTime: START,
      durationMinutes: 30,
    });

    expect(lastFetchBody().summary).toBe("Call with Elena Fischer");
  });

  it("uses a given subject over the default", async () => {
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });

    await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      type: "meeting",
      startDateTime: START,
      durationMinutes: 30,
      subject: "Term sheet review",
    });

    expect(lastFetchBody().summary).toBe("Term sheet review");
  });

  it("requests sendUpdates=all so the investor actually receives an invite", async () => {
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });

    await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      type: "call",
      startDateTime: START,
      durationMinutes: 30,
    });

    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toContain("sendUpdates=all");
    expect(call[1].headers.Authorization).toBe("Bearer access-token");
  });
});

describe("scheduleMeeting — deal linking", () => {
  it("uses the explicitly given pipelineId once it's verified", async () => {
    mockPrisma.pipeline.findUnique.mockResolvedValue({ startupInvestorId: INVESTOR_ID } as never);
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });

    await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      pipelineId: PIPELINE_ID,
      type: "call",
      startDateTime: START,
      durationMinutes: 30,
    });

    expect(mockPrisma.pipeline.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pipelineId: PIPELINE_ID }) }),
    );
  });

  it("falls back to the investor's active-round deal when no pipelineId is given", async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue({ id: "auto-deal" } as never);
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });

    await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      type: "call",
      startDateTime: START,
      durationMinutes: 30,
    });

    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pipelineId: "auto-deal" }) }),
    );
  });
});

describe("scheduleMeeting — failure ordering", () => {
  it("never writes a log when event creation itself fails", async () => {
    mockEventResponse(502, "upstream error");

    await expect(
      service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
        type: "call",
        startDateTime: START,
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({ code: "CALENDAR_EVENT_FAILED" });

    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  it("maps a 403 insufficient-scope response to GOOGLE_INSUFFICIENT_SCOPE", async () => {
    mockEventResponse(403, "Request had insufficient authentication scopes.");

    await expect(
      service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
        type: "call",
        startDateTime: START,
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_INSUFFICIENT_SCOPE" });

    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  it("writes exactly one log for a successful schedule, typed and sourced from calendar", async () => {
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });

    const result = await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      type: "meeting",
      startDateTime: START,
      durationMinutes: 30,
    });

    expect(result).toEqual({
      eventId: "event-1",
      htmlLink: "https://calendar.google.com/event-1",
      logCreated: true,
    });
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "meeting",
          source: "google_calendar",
          externalId: "event-1",
          interactionDate: START,
        }),
      }),
    );
  });

  it("never reports the schedule as failed when only the log write fails", async () => {
    mockEventResponse(200, { id: "event-1", htmlLink: "https://calendar.google.com/event-1" });
    mockPrisma.interactionLog.create.mockRejectedValue(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await service.scheduleMeeting(STARTUP_ID, INVESTOR_ID, USER_ID, {
      type: "call",
      startDateTime: START,
      durationMinutes: 30,
    });

    expect(result).toEqual({
      eventId: "event-1",
      htmlLink: "https://calendar.google.com/event-1",
      logCreated: false,
    });
  });
});
