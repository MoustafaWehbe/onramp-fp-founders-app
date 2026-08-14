import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Commitment, FundraisingRound, RoundMetrics } from "../../lib/fundraising-api";

const listFundraisingRounds = vi.fn();
const listCommitments = vi.fn();
const getRoundMetrics = vi.fn();
const getFundingHistory = vi.fn();
vi.mock("../../lib/fundraising-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/fundraising-api")>()),
  listFundraisingRounds: (...a: unknown[]) => listFundraisingRounds(...a),
  listCommitments: (...a: unknown[]) => listCommitments(...a),
  getRoundMetrics: (...a: unknown[]) => getRoundMetrics(...a),
  getFundingHistory: (...a: unknown[]) => getFundingHistory(...a),
  createCommitment: vi.fn(),
  createFundraisingRound: vi.fn(),
  updateCommitment: vi.fn(),
  updateFundraisingRound: vi.fn(),
}));

vi.mock("../../lib/pipeline-api", () => ({
  listPipelineEntries: vi.fn().mockResolvedValue({ data: [], meta: {} }),
}));

vi.mock("../../hooks/useWorkspace", () => ({ useActiveStartupId: () => "startup-1" }));
vi.mock("../../hooks/usePermissions", async () => {
  const { roleCan } = await import("../../lib/permissions");
  return { usePermissions: () => ({ role: "owner", can: (r: never, a: never) => roleCan("owner", r, a) }) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { Fundraising } = await import("../../pages/dashboard/Fundraising/Fundraising");

function round(overrides: Partial<FundraisingRound> = {}): FundraisingRound {
  return {
    id: "round-1",
    startupId: "startup-1",
    roundName: "Seed",
    targetAmount: 1_000_000,
    minimumTicketSize: null,
    equityOfferedPercentage: null,
    currency: "USD",
    status: "active",
    firstCloseDate: null,
    targetCloseDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function commitment(id: string, amount: number, status: Commitment["status"]): Commitment {
  return {
    id,
    startupId: "startup-1",
    investorId: `inv-${id}`,
    investor: {
      id: `inv-${id}`,
      startupId: "startup-1",
      fullName: `Investor ${id}`,
      email: null,
      ventureFirm: null,
      investorType: null,
      sectorFocus: null,
      investmentStagePreference: null,
      linkedinUrl: null,
      notes: null,
      notesCreatedAt: null,
      notesCreatedBy: null,
      notesUpdatedAt: null,
      notesUpdatedBy: null,
      source: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    pipelineId: `deal-${id}`,
    roundId: "round-1",
    amount,
    status,
    expectedCloseDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function metrics(overrides: Partial<RoundMetrics> = {}): RoundMetrics {
  return {
    currency: "USD",
    targetAmount: 1_000_000,
    wired: 120_000,
    hardCircled: 110_000,
    softCircled: 95_000,
    bankableRaised: 230_000,
    remainingGap: 770_000,
    percentToTarget: 23,
    weightedPipeline: 0,
    daysToClose: null,
    atRiskCommitments: [],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Fundraising />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listFundraisingRounds.mockResolvedValue({
    data: [round()],
    meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
  });
  listCommitments.mockResolvedValue({
    data: [
      commitment("a", 120_000, "wired"),
      commitment("b", 110_000, "hard_circled"),
      // The one that must never reach the target: a verbal yes.
      commitment("c", 95_000, "soft_circled"),
      commitment("d", 40_000, "withdrawn"),
    ],
    meta: { page: 1, limit: 100, total: 4, totalPages: 1 },
  });
  getRoundMetrics.mockResolvedValue(metrics());
  getFundingHistory.mockResolvedValue([
    { id: "e1", commitmentId: "a", investorName: "Investor a", fromStatus: null, toStatus: "wired", amount: 120_000, createdAt: "2026-01-01T00:00:00.000Z" },
  ]);
});

describe("Fundraising round totals", () => {
  /**
   * The whole point of the soft/hard vocabulary: a verbal commitment must be
   * visible without being counted as raised. Counting it is how a founder
   * ends up believing they have closed money they have not.
   */
  it("keeps soft-circled money out of the target while still showing it", async () => {
    renderPage();

    // The metric titles render before the commitments query resolves, so wait
    // on a value — otherwise the tiles are asserted while still showing zero.
    const totals = within(await screen.findByRole("region", { name: "Round totals" }));
    const wiredValue = await totals.findByText("$120,000");
    expect(within(wiredValue.parentElement!).getByText("Wired")).toBeInTheDocument();

    const hardValue = totals.getByText("$110,000");
    expect(within(hardValue.parentElement!).getByText("Hard-circled")).toBeInTheDocument();

    const softValue = totals.getByText("$95,000");
    expect(within(softValue.parentElement!).getByText("Soft-circled")).toBeInTheDocument();
    expect(within(softValue.parentElement!).getByText(/not counted/i)).toBeInTheDocument();

    // Bankable is wired + hard-circled only: 230k of 1M, so 770k still to go.
    // Neither the soft-circled 95k nor the withdrawn 40k moves either number.
    const gapValue = totals.getByText("$770,000");
    expect(within(gapValue.parentElement!).getByText("Gap to target")).toBeInTheDocument();
    expect(within(gapValue.parentElement!).getByText(/23% of \$1,000,000/)).toBeInTheDocument();
  });

  it("calls the raise oversubscribed once signed money passes the target", async () => {
    listCommitments.mockResolvedValue({
      data: [commitment("a", 900_000, "wired"), commitment("b", 250_000, "hard_circled")],
      meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });

    renderPage();

    // 1.15M against a 1M target — a decision to make, not a silent overflow.
    const value = await within(await screen.findByRole("region", { name: "Round totals" })).findByText("$150,000");
    expect(within(value.parentElement!).getByText("Oversubscribed")).toBeInTheDocument();
  });

  it("shows how long is left to the first close", async () => {
    const inThreeWeeks = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
    listFundraisingRounds.mockResolvedValue({
      data: [round({ firstCloseDate: inThreeWeeks })],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    renderPage();

    expect(await screen.findByText("First close")).toBeInTheDocument();
    expect(screen.getByText("in 3 weeks")).toBeInTheDocument();
  });

  it("filters the commitments table when a status tile is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Investor a");
    expect(screen.getByText("Investor b")).toBeInTheDocument();
    expect(screen.getByText("Investor c")).toBeInTheDocument();

    const totals = within(await screen.findByRole("region", { name: "Round totals" }));
    await user.click(totals.getByText("Wired").closest("button")!);

    expect(screen.getByText("Investor a")).toBeInTheDocument();
    expect(screen.queryByText("Investor b")).not.toBeInTheDocument();
    expect(screen.queryByText("Investor c")).not.toBeInTheDocument();
    expect(screen.getByText(/wired commitments only/i)).toBeInTheDocument();

    // Clicking the same tile again turns the filter back off.
    await user.click(screen.getByRole("button", { name: /Clear filter/ }));
    expect(screen.getByText("Investor b")).toBeInTheDocument();
  });
});

describe("Fundraising round intelligence", () => {
  it("shows the weighted pipeline and days to close from the metrics endpoint", async () => {
    getRoundMetrics.mockResolvedValue(
      metrics({ weightedPipeline: 340_000, daysToClose: 12 }),
    );
    renderPage();

    const forecast = within(await screen.findByRole("region", { name: "Round intelligence" }));
    expect(await forecast.findByText("$340,000")).toBeInTheDocument();
    expect(forecast.getByText("Weighted pipeline")).toBeInTheDocument();
    expect(forecast.getByText("12d")).toBeInTheDocument();
    expect(forecast.getByText("Days to close")).toBeInTheDocument();
  });

  it("shows a plain dash when the round has no close date set", async () => {
    getRoundMetrics.mockResolvedValue(metrics({ daysToClose: null }));
    renderPage();

    const forecast = within(await screen.findByRole("region", { name: "Round intelligence" }));
    expect(await forecast.findByText("—")).toBeInTheDocument();
    expect(forecast.getByText("No close date set for this round")).toBeInTheDocument();
  });

  it("lists at-risk commitments and opens the edit dialog when one is clicked", async () => {
    getRoundMetrics.mockResolvedValue(
      metrics({
        atRiskCommitments: [
          { id: "a", investorName: "Investor a", amount: 120_000, status: "soft_circled", expectedCloseDate: "2026-01-01T00:00:00.000Z", daysOverdue: 9 },
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/9d overdue/)).toBeInTheDocument();

    await user.click(screen.getByText(/9d overdue/).closest("button")!);

    expect(await screen.findByText("Edit commitment")).toBeInTheDocument();
  });

  it("says nothing is at risk when the list is empty", async () => {
    renderPage();

    expect(await screen.findByText("Nothing at risk right now.")).toBeInTheDocument();
  });

  it("shows an inline error for the metrics panel without blocking the rest of the page", async () => {
    getRoundMetrics.mockRejectedValue(new Error("network down"));
    renderPage();

    // The commitments table, sourced from a different request, still renders.
    expect(await screen.findByText("Investor a")).toBeInTheDocument();
    expect(screen.getByText(/Could not load round metrics/)).toBeInTheDocument();
  });
});

describe("Fundraising funding history chart", () => {
  it("renders the chart once funding history resolves", async () => {
    renderPage();

    expect(await screen.findByLabelText("Funding progress chart")).toBeInTheDocument();
  });

  it("shows an empty state when the round has no commitment history yet", async () => {
    getFundingHistory.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("No commitments recorded yet")).toBeInTheDocument();
  });

  it("lets the founder switch the chart's time range", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Funding progress chart");

    const range = within(screen.getByRole("group", { name: "Chart time range" }));
    await user.click(range.getByText("12M"));

    expect(range.getByText("12M")).toHaveAttribute("aria-pressed", "true");
  });
});
