import { notifyStaleLeadsAndIdleDeals } from "../../src/jobs/pipeline-reminders";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    pipeline: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    startup: { findMany: jest.fn() },
    interactionLog: { groupBy: jest.fn() },
  },
}));

jest.mock("../../src/services/notification.service", () => ({
  notificationService: { notifyLeadStale: jest.fn(), notifyDealNoNextStep: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { notificationService } from "../../src/services/notification.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockLeadStale = notificationService.notifyLeadStale as jest.Mock;
const mockNoNextStep = notificationService.notifyDealNoNextStep as jest.Mock;

const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
const FOUNDER_USER_ID = "00000000-0000-0000-0000-000000000002";
const STARTUP_ID = "00000000-0000-0000-0000-000000000003";
const DEAL_ID = "00000000-0000-0000-0000-000000000004";
const INVESTOR_ID = "00000000-0000-0000-0000-000000000005";

const DAY_MS = 24 * 60 * 60 * 1000;

function deal(overrides: Record<string, unknown> = {}) {
  return {
    id: DEAL_ID,
    startupId: STARTUP_ID,
    startupInvestorId: INVESTOR_ID,
    isLead: false,
    createdAt: new Date(Date.now() - 30 * DAY_MS),
    owner: { userId: OWNER_USER_ID },
    startupInvestor: { fullName: "Ada Lovelace" },
    ...overrides,
  };
}

/** The startup row the job falls back to when a deal has no owner. */
function startupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STARTUP_ID,
    createdBy: FOUNDER_USER_ID,
    members: [{ userId: FOUNDER_USER_ID }],
    ...overrides,
  };
}

function setup({
  deals = [deal()],
  dealsWithOpenTasks = [] as string[],
  lastTouchDaysAgo = null as number | null,
  startups = [startupRow()],
}) {
  (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue(deals);
  (mockPrisma.task.findMany as jest.Mock).mockResolvedValue(
    dealsWithOpenTasks.map((pipelineId) => ({ pipelineId })),
  );
  (mockPrisma.startup.findMany as jest.Mock).mockResolvedValue(startups);
  (mockPrisma.interactionLog.groupBy as jest.Mock).mockResolvedValue(
    lastTouchDaysAgo === null
      ? []
      : [
          {
            startupInvestorId: INVESTOR_ID,
            _max: {
              interactionDate: new Date(Date.now() - lastTouchDaysAgo * DAY_MS),
              createdAt: new Date(Date.now() - lastTouchDaysAgo * DAY_MS),
            },
          },
        ],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("notifyStaleLeadsAndIdleDeals", () => {
  it("only considers live deals in a round that can still take work", async () => {
    setup({ deals: [] });

    await notifyStaleLeadsAndIdleDeals();

    expect(mockPrisma.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stage: { notIn: ["committed", "passed"] },
          round: { status: { in: ["draft", "active"] } },
        },
      }),
    );
  });

  it("tells the deal's owner when a lead investor has gone quiet", async () => {
    setup({
      deals: [deal({ isLead: true })],
      dealsWithOpenTasks: [DEAL_ID],
      lastTouchDaysAgo: 12,
    });

    await notifyStaleLeadsAndIdleDeals();

    expect(mockLeadStale).toHaveBeenCalledWith({
      userId: OWNER_USER_ID,
      startupId: STARTUP_ID,
      pipelineId: DEAL_ID,
      investorName: "Ada Lovelace",
      daysQuiet: 12,
    });
    // The lead being quiet is the more urgent fact about the same deal.
    expect(mockNoNextStep).not.toHaveBeenCalled();
  });

  it("leaves a recently-contacted lead alone", async () => {
    setup({
      deals: [deal({ isLead: true })],
      dealsWithOpenTasks: [DEAL_ID],
      lastTouchDaysAgo: 2,
    });

    await notifyStaleLeadsAndIdleDeals();

    expect(mockLeadStale).not.toHaveBeenCalled();
  });

  it("reports a live deal carrying no open task", async () => {
    setup({ deals: [deal()], dealsWithOpenTasks: [], lastTouchDaysAgo: 1 });

    await notifyStaleLeadsAndIdleDeals();

    expect(mockNoNextStep).toHaveBeenCalledWith({
      userId: OWNER_USER_ID,
      startupId: STARTUP_ID,
      pipelineId: DEAL_ID,
      investorName: "Ada Lovelace",
    });
  });

  // Otherwise every deal added this morning is reported before anyone has had
  // a chance to give it a next step.
  it("gives a freshly added deal a grace period before chasing it", async () => {
    setup({
      deals: [deal({ createdAt: new Date(Date.now() - 1 * DAY_MS) })],
      dealsWithOpenTasks: [],
    });

    await notifyStaleLeadsAndIdleDeals();

    expect(mockNoNextStep).not.toHaveBeenCalled();
  });

  it("falls back to the founder for a deal nobody owns", async () => {
    setup({ deals: [deal({ owner: null })], dealsWithOpenTasks: [] });

    await notifyStaleLeadsAndIdleDeals();

    expect(mockNoNextStep).toHaveBeenCalledWith(
      expect.objectContaining({ userId: FOUNDER_USER_ID }),
    );
  });

  it("stays silent when the founder is no longer an active member", async () => {
    setup({
      deals: [deal({ owner: null })],
      dealsWithOpenTasks: [],
      startups: [startupRow({ members: [] })],
    });

    await notifyStaleLeadsAndIdleDeals();

    expect(mockNoNextStep).not.toHaveBeenCalled();
    expect(mockLeadStale).not.toHaveBeenCalled();
  });

  // A deal nobody has ever contacted has no logs at all, so its age on the
  // board is the only clock available.
  it("measures an investor never contacted from the day the deal was added", async () => {
    setup({
      deals: [deal({ isLead: true, createdAt: new Date(Date.now() - 20 * DAY_MS) })],
      dealsWithOpenTasks: [DEAL_ID],
      lastTouchDaysAgo: null,
    });

    await notifyStaleLeadsAndIdleDeals();

    expect(mockLeadStale).toHaveBeenCalledWith(expect.objectContaining({ daysQuiet: 20 }));
  });
});
