import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Commitment, FundraisingRound } from "../../lib/fundraising-api";

const listFundraisingRounds = vi.fn();
const listCommitments = vi.fn();
vi.mock("../../lib/fundraising-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/fundraising-api")>()),
  listFundraisingRounds: (...a: unknown[]) => listFundraisingRounds(...a),
  listCommitments: (...a: unknown[]) => listCommitments(...a),
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
});
