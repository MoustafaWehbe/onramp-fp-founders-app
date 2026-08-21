import { prisma } from "../../src/db/prisma";
import { ForecastService } from "../../src/services/forecast.service";
import { fundraisingService } from "../../src/services/fundraising.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    pipelineStageEvent: { findMany: jest.fn() },
    commitment: { findMany: jest.fn() },
    pipeline: { findMany: jest.fn() },
  },
}));

jest.mock("../../src/services/fundraising.service", () => ({
  fundraisingService: { getRound: jest.fn(), listRounds: jest.fn(), getRoundMetrics: jest.fn() },
}));

const ROUND = { id: "round-1", roundName: "Seed", currency: "USD" };
const METRICS = { targetAmount: 1_000_000, bankableRaised: 200_000, remainingGap: 800_000, weightedPipeline: 0, daysToClose: null, atRiskCommitments: [] };

function event(pipelineId: string, fromStage: string | null, toStage: string, dayOffset: number) {
  return { pipelineId, fromStage, toStage, createdAt: new Date(Date.now() - (180 - dayOffset) * 24 * 60 * 60 * 1000) };
}

describe("ForecastService.forecastRoundClose", () => {
  beforeEach(() => jest.clearAllMocks());

  it("computes a deterministic projection from fixed stage-event and commitment fixtures", async () => {
    (fundraisingService.getRound as jest.Mock).mockResolvedValue(ROUND);
    (fundraisingService.getRoundMetrics as jest.Mock).mockResolvedValue(METRICS);

    // Two deals walk the same path with identical day-gaps: deal A completes
    // sourced -> committed, deal B stalls at due_diligence. This makes every
    // stage's median a single deterministic value and the term_sheet leg's
    // conversion rate exactly 0.5 (1 of 2 deals that reached it advanced).
    (prisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue([
      event("p1", null, "sourced", 0),
      event("p1", "sourced", "contacted", 2),
      event("p1", "contacted", "meeting_scheduled", 5),
      event("p1", "meeting_scheduled", "due_diligence", 9),
      event("p1", "due_diligence", "term_sheet", 14),
      event("p1", "term_sheet", "committed", 20),
      event("p2", null, "sourced", 1),
      event("p2", "sourced", "contacted", 3),
      event("p2", "contacted", "meeting_scheduled", 6),
      event("p2", "meeting_scheduled", "due_diligence", 10),
    ]);
    (prisma.commitment.findMany as jest.Mock)
      .mockResolvedValueOnce([{ amount: { toString: () => "50000" } as any }]) // soft_circled
      .mockResolvedValueOnce([
        { amount: { toString: () => "100000" } as any },
        { amount: { toString: () => "150000" } as any },
      ]); // bankable (hard_circled/wired)
    (prisma.pipeline.findMany as jest.Mock).mockResolvedValue([
      { expectedAmount: { toString: () => "200000" } as any, probabilityPercentage: 50 },
    ]);

    const result = await new ForecastService().forecastRoundClose("startup-a", "round-1");

    expect(result.round).toEqual({ id: ROUND.id, name: ROUND.roundName, currency: ROUND.currency });
    expect(result.targetAmount).toBe(1_000_000);
    expect(result.committedToDate).toBe(200_000);
    expect(result.remainingGap).toBe(800_000);
    expect(result.softPipeline).toBe(150_000); // 50,000 soft-circled + 200,000 * 0.5 weighted
    expect(result.inputs.stageEventCount).toBe(10);
    expect(result.confidence).toBe("medium");
    expect(result.insufficientData).toBe(false);
    expect(result.inputs.stageVelocityDays).toMatchObject({
      sourced: 2, contacted: 3, meeting_scheduled: 4, due_diligence: 5, term_sheet: 6,
    });
    expect(result.inputs.cycleTimeDays).toBe(20);
    expect(result.inputs.conversion.find((leg) => leg.fromStage === "term_sheet")).toMatchObject({ reached: 1, advanced: 1, rate: 1 });
    expect(result.inputs.conversion.find((leg) => leg.fromStage === "due_diligence")).toMatchObject({ reached: 2, advanced: 1, rate: 0.5 });
    expect(result.inputs.overallConversionRate).toBe(0.5);
    expect(result.inputs.averageCheckSize).toBe(125_000); // median(100000, 150000)
    // expectedValuePerDay = (2 new deals / 180 days) * 0.5 conversion * 125,000 average check = 62,500 / 90
    expect(result.inputs.expectedValuePerDay).toBeCloseTo(62_500 / 90, 5);
    // projectedDaysToClose = ceil(800,000 / (62,500/90)) = 1152
    expect(result.projectedDaysToClose).toBe(1152);
  });

  it("flags insufficient data and returns no projection when the stage-event history is thin", async () => {
    (fundraisingService.getRound as jest.Mock).mockResolvedValue(ROUND);
    (fundraisingService.getRoundMetrics as jest.Mock).mockResolvedValue(METRICS);
    (prisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue([
      event("p1", null, "sourced", 0),
      event("p1", "sourced", "contacted", 2),
    ]);
    (prisma.commitment.findMany as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    (prisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    const result = await new ForecastService().forecastRoundClose("startup-a", "round-1");

    expect(result.insufficientData).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.projectedDaysToClose).toBeNull();
    expect(result.inputs.averageCheckSize).toBeNull();
  });

  it("never overstates a conversion leg with no observed data as zero", async () => {
    (fundraisingService.getRound as jest.Mock).mockResolvedValue(ROUND);
    (fundraisingService.getRoundMetrics as jest.Mock).mockResolvedValue(METRICS);
    // Eight events, but none ever reach term_sheet or committed the last leg
    // has zero deals reaching it, which must read as "no data," not "0% conversion."
    (prisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => event(`p${i}`, null, "sourced", i)),
    );
    (prisma.commitment.findMany as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    (prisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    const result = await new ForecastService().forecastRoundClose("startup-a", "round-1");

    const termSheetLeg = result.inputs.conversion.find((leg) => leg.fromStage === "term_sheet");
    expect(termSheetLeg?.reached).toBe(0);
    expect(termSheetLeg?.rate).toBeNull();
    expect(result.inputs.overallConversionRate).toBeNull();
    expect(result.projectedDaysToClose).toBeNull();
  });

  it("resolves the active round when none is given, matching get_round_health's fallback", async () => {
    (fundraisingService.listRounds as jest.Mock).mockResolvedValue({ data: [ROUND] });
    (fundraisingService.getRoundMetrics as jest.Mock).mockResolvedValue(METRICS);
    (prisma.pipelineStageEvent.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.commitment.findMany as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    (prisma.pipeline.findMany as jest.Mock).mockResolvedValue([]);

    await new ForecastService().forecastRoundClose("startup-a");

    expect(fundraisingService.listRounds).toHaveBeenCalledWith("startup-a", expect.objectContaining({ status: "active" }));
    expect(fundraisingService.getRound).not.toHaveBeenCalled();
  });

  it("reports no round rather than guessing when the startup has no active round", async () => {
    (fundraisingService.listRounds as jest.Mock).mockResolvedValue({ data: [] });

    const result = await new ForecastService().forecastRoundClose("startup-a");

    expect(result).toEqual({ round: null, insufficientData: true, confidence: "low" });
    expect(fundraisingService.getRoundMetrics).not.toHaveBeenCalled();
  });
});
