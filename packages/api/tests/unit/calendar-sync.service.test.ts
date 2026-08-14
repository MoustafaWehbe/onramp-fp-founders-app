import { CalendarSyncService } from "../../src/services/calendar-sync.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    googleConnection: { findUnique: jest.fn(), update: jest.fn() },
    startupMember: { findMany: jest.fn() },
    startupInvestor: { findMany: jest.fn() },
    pipeline: { findFirst: jest.fn() },
    interactionLog: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("../../src/services/google-connection.service", () => ({
  googleConnectionService: { getValidAccessToken: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { googleConnectionService } from "../../src/services/google-connection.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetValidAccessToken = googleConnectionService.getValidAccessToken as jest.Mock;
const service = new CalendarSyncService();

const USER_ID = "user-1";
const STARTUP_ID = "startup-1";

const ACTIVE_CONNECTION = {
  userId: USER_ID,
  status: "active",
  calendarSyncEnabled: true,
  calendarSyncToken: null as string | null,
};

function mockFetchOnce(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  });
}

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    status: "confirmed",
    summary: "Intro call",
    description: "Discussing the seed round.",
    start: { dateTime: "2026-05-30T10:00:00Z" },
    end: { dateTime: "2026-05-30T10:30:00Z" }, // 2 days before the fake "now" below — past, and within the recency window
    attendees: [{ email: "investor@example.com" }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2026-06-01T00:00:00Z"));
  global.fetch = jest.fn();
  mockPrisma.startupMember.findMany.mockResolvedValue([{ startupId: STARTUP_ID }] as never);
  mockGetValidAccessToken.mockResolvedValue("access-token");
  mockPrisma.googleConnection.update.mockResolvedValue({} as never);
  mockPrisma.pipeline.findFirst.mockResolvedValue(null);
  mockPrisma.startupInvestor.findMany.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("syncUserCalendar — guard clauses", () => {
  it("no-ops when there is no connection", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(null);
    const stats = await service.syncUserCalendar(USER_ID);
    expect(stats).toEqual({ created: 0, updated: 0, retracted: 0, skipped: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("no-ops when the connection needs reauth", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      ...ACTIVE_CONNECTION,
      status: "needs_reauth",
    } as never);
    await service.syncUserCalendar(USER_ID);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("no-ops when the founder paused calendar sync", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      ...ACTIVE_CONNECTION,
      calendarSyncEnabled: false,
    } as never);
    await service.syncUserCalendar(USER_ID);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("no-ops when the user belongs to no active startup", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockPrisma.startupMember.findMany.mockResolvedValue([]);
    await service.syncUserCalendar(USER_ID);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("records the failure and rethrows when the access token can't be obtained", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockGetValidAccessToken.mockRejectedValue(new Error("boom"));

    await expect(service.syncUserCalendar(USER_ID)).rejects.toThrow("boom");
    expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { lastError: "boom" },
    });
  });
});

describe("syncUserCalendar — request shape", () => {
  // Verified live against a real calendar: Google only returns nextSyncToken
  // on a listing with no time bound at all. Sending timeMin "to keep the
  // bootstrap walk small" gets a response back with no usable cursor, so
  // every future sync would silently stay a full walk forever instead of
  // going incremental. timeMin/orderBy must never appear in either mode.
  it("never sends timeMin or orderBy on the bootstrap walk (no stored token)", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockFetchOnce(200, { items: [], nextSyncToken: "token-1" });

    await service.syncUserCalendar(USER_ID);

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
    expect(url.searchParams.get("syncToken")).toBeNull();
    expect(url.searchParams.has("timeMin")).toBe(false);
    expect(url.searchParams.has("orderBy")).toBe(false);
    expect(url.searchParams.get("singleEvents")).toBe("true");
  });

  it("sends only syncToken, never timeMin/orderBy, once a cursor exists", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      ...ACTIVE_CONNECTION,
      calendarSyncToken: "stored-token",
    } as never);
    mockFetchOnce(200, { items: [], nextSyncToken: "token-2" });

    await service.syncUserCalendar(USER_ID);

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
    expect(url.searchParams.get("syncToken")).toBe("stored-token");
    expect(url.searchParams.has("timeMin")).toBe(false);
    expect(url.searchParams.has("orderBy")).toBe(false);
  });

  it("sends the access token as a bearer header", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockFetchOnce(200, { items: [] });

    await service.syncUserCalendar(USER_ID);

    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer access-token");
  });
});

describe("syncUserCalendar — sync token lifecycle", () => {
  it("persists nextSyncToken only once the full pass completes", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockFetchOnce(200, { items: [], nextSyncToken: "final-token" });

    await service.syncUserCalendar(USER_ID);

    expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { calendarSyncToken: "final-token", lastSyncedAt: expect.any(Date), lastError: null },
    });
  });

  it("pages through nextPageToken and only stores the token from the final page", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockFetchOnce(200, { items: [], nextPageToken: "page-2" });
    mockFetchOnce(200, { items: [], nextSyncToken: "token-after-page-2" });

    await service.syncUserCalendar(USER_ID);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondUrl = new URL((global.fetch as jest.Mock).mock.calls[1][0] as string);
    expect(secondUrl.searchParams.get("pageToken")).toBe("page-2");
    expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ calendarSyncToken: "token-after-page-2" }) }),
    );
  });

  it("clears the cursor and skips processing on a 410 (expired sync token)", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      ...ACTIVE_CONNECTION,
      calendarSyncToken: "stale-token",
    } as never);
    mockFetchOnce(410, "Gone");

    const stats = await service.syncUserCalendar(USER_ID);

    expect(stats).toEqual({ created: 0, updated: 0, retracted: 0, skipped: 0 });
    expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { calendarSyncToken: null, lastError: "sync_token_expired" },
    });
    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  it("leaves the stored token untouched when the page cap is hit mid-pass", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      ...ACTIVE_CONNECTION,
      calendarSyncToken: "still-current",
    } as never);
    // Every page claims there's another page, so the 20-page cap is what stops it.
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ items: [], nextPageToken: "more" }),
      text: () => Promise.resolve(""),
    });

    await service.syncUserCalendar(USER_ID);

    expect(global.fetch).toHaveBeenCalledTimes(40);
    expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { lastSyncedAt: expect.any(Date), lastError: "sync_incomplete_will_resume" },
    });
    // Explicitly not present — the previous cursor must be left alone.
    const call = mockPrisma.googleConnection.update.mock.calls[0][0] as { data: object };
    expect(call.data).not.toHaveProperty("calendarSyncToken");
  });
});

describe("syncUserCalendar — event filtering", () => {
  async function runWithEvents(events: unknown[]) {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockFetchOnce(200, { items: events, nextSyncToken: "t" });
    return service.syncUserCalendar(USER_ID);
  }

  it("skips all-day events (date instead of dateTime)", async () => {
    const stats = await runWithEvents([
      baseEvent({ start: { date: "2026-01-01" }, end: { date: "2026-01-02" } }),
    ]);
    expect(stats.skipped).toBe(1);
    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  it("skips a meeting that hasn't ended yet", async () => {
    const stats = await runWithEvents([
      baseEvent({ end: { dateTime: "2026-12-31T00:00:00Z" } }),
    ]);
    expect(stats.skipped).toBe(1);
    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  // The bootstrap walk sees a founder's whole calendar history (Google won't
  // hand back a sync token for a time-bounded query — see fetchAllEvents), so
  // this is what actually keeps years-old meetings off the timeline.
  it("skips a meeting older than the 90-day recency window", async () => {
    const stats = await runWithEvents([
      baseEvent({
        start: { dateTime: "2025-01-01T10:00:00Z" },
        end: { dateTime: "2025-01-01T10:30:00Z" },
      }),
    ]);
    expect(stats.skipped).toBe(1);
    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  it("skips a meeting the founder declined", async () => {
    const stats = await runWithEvents([
      baseEvent({ attendees: [{ email: "investor@example.com", self: true, responseStatus: "declined" }] }),
    ]);
    expect(stats.skipped).toBe(1);
    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  it("skips an event with no attendees — nothing to match", async () => {
    const stats = await runWithEvents([baseEvent({ attendees: [] })]);
    expect(stats.skipped).toBe(1);
  });

  it("never creates a log for an event that matched no investor", async () => {
    mockPrisma.startupInvestor.findMany.mockResolvedValue([]);
    const stats = await runWithEvents([baseEvent()]);
    expect(stats.created).toBe(0);
    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });
});

describe("syncUserCalendar — matching and writing logs", () => {
  it("creates a meeting log for a matched investor, sourced and tagged with the event id", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockPrisma.startupInvestor.findMany.mockResolvedValue([{ id: "investor-1" }] as never);
    mockPrisma.interactionLog.findUnique.mockResolvedValue(null);
    mockFetchOnce(200, { items: [baseEvent()], nextSyncToken: "t" });

    const stats = await service.syncUserCalendar(USER_ID);

    expect(stats.created).toBe(1);
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith({
      data: {
        startupInvestorId: "investor-1",
        createdBy: USER_ID,
        type: "meeting",
        source: "google_calendar",
        externalId: "evt-1",
        pipelineId: null,
        subject: "Intro call",
        description: "Discussing the seed round.",
        interactionDate: new Date("2026-05-30T10:00:00Z"),
      },
    });
  });

  it("links the log to the investor's deal in the active round when one exists", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockPrisma.startupInvestor.findMany.mockResolvedValue([{ id: "investor-1" }] as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({ id: "deal-1" } as never);
    mockPrisma.interactionLog.findUnique.mockResolvedValue(null);
    mockFetchOnce(200, { items: [baseEvent()], nextSyncToken: "t" });

    await service.syncUserCalendar(USER_ID);

    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pipelineId: "deal-1" }) }),
    );
  });

  it("updates an untouched, previously-synced log instead of duplicating it", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockPrisma.startupInvestor.findMany.mockResolvedValue([{ id: "investor-1" }] as never);
    mockPrisma.interactionLog.findUnique.mockResolvedValue({
      id: "log-1",
      editedByUser: false,
    } as never);
    mockFetchOnce(200, { items: [baseEvent({ summary: "Renamed meeting" })], nextSyncToken: "t" });

    const stats = await service.syncUserCalendar(USER_ID);

    expect(stats.updated).toBe(1);
    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.interactionLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: expect.objectContaining({ subject: "Renamed meeting" }),
    });
  });

  it("never overwrites a log the founder has edited by hand", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockPrisma.startupInvestor.findMany.mockResolvedValue([{ id: "investor-1" }] as never);
    mockPrisma.interactionLog.findUnique.mockResolvedValue({
      id: "log-1",
      editedByUser: true,
    } as never);
    mockFetchOnce(200, { items: [baseEvent({ summary: "Renamed meeting" })], nextSyncToken: "t" });

    await service.syncUserCalendar(USER_ID);

    expect(mockPrisma.interactionLog.update).not.toHaveBeenCalled();
    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
  });

  it("fans out to every active startup the founder belongs to", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockPrisma.startupMember.findMany.mockResolvedValue([
      { startupId: "startup-1" },
      { startupId: "startup-2" },
    ] as never);
    mockPrisma.startupInvestor.findMany.mockResolvedValue([{ id: "investor-1" }] as never);
    mockPrisma.interactionLog.findUnique.mockResolvedValue(null);
    mockFetchOnce(200, { items: [baseEvent()], nextSyncToken: "t" });

    const stats = await service.syncUserCalendar(USER_ID);

    expect(stats.created).toBe(2);
    expect(mockPrisma.startupInvestor.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("syncUserCalendar — cancellation retracts unedited logs only", () => {
  it("deletes untouched synced logs for a cancelled event", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(ACTIVE_CONNECTION as never);
    mockPrisma.interactionLog.deleteMany.mockResolvedValue({ count: 1 } as never);
    mockFetchOnce(200, {
      items: [baseEvent({ status: "cancelled", attendees: undefined, start: undefined, end: undefined })],
      nextSyncToken: "t",
    });

    const stats = await service.syncUserCalendar(USER_ID);

    expect(stats.retracted).toBe(1);
    expect(mockPrisma.interactionLog.deleteMany).toHaveBeenCalledWith({
      where: { externalId: "evt-1", source: "google_calendar", editedByUser: false },
    });
  });
});
