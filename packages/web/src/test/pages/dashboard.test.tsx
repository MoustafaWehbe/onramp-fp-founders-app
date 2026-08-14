import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const listRounds = vi.fn();
const listCommitments = vi.fn();
const getFundingHistory = vi.fn();
const listPipeline = vi.fn();
const getFocus = vi.fn();
const listTasks = vi.fn();

vi.mock("../../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ isLoading: false, hasNoWorkspace: false, activeStartupId: "startup-1" }),
}));
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1", firstName: "Jane" } }),
}));
vi.mock("../../hooks/usePermissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../../lib/app-store", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    activeRoundIds: { "startup-1": "round-1" },
    setActiveRoundId: vi.fn(),
    fundingChartRanges: {},
    setFundingChartRange: vi.fn(),
  }),
}));
vi.mock("../../lib/fundraising-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/fundraising-api")>()),
  listFundraisingRounds: () => listRounds(),
  listCommitments: () => listCommitments(),
  getFundingHistory: () => getFundingHistory(),
}));
vi.mock("../../lib/pipeline-api", () => ({
  listPipelineEntries: () => listPipeline(),
  getPipelineFocus: () => getFocus(),
}));
vi.mock("../../lib/team-api", () => ({
  listMembers: vi.fn().mockResolvedValue([{ id: "member-1", user: { id: "user-1", firstName: "Jane", lastName: "Doe" } }]),
}));
vi.mock("../../lib/task-api", () => ({
  listTasks: () => listTasks(),
  setTaskStatus: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { Dashboard } = await import("../../pages/dashboard/Dashboard");

beforeEach(() => {
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ data: [{ id: "round-1", roundName: "Seed", status: "active", targetAmount: 1_000_000, currency: "USD" }] });
  listCommitments.mockResolvedValue({ data: [{ amount: 200_000, status: "wired", createdAt: "2026-08-01T00:00:00.000Z" }] });
  getFundingHistory.mockResolvedValue([
    { id: "e1", commitmentId: "c1", investorName: "Ada Investor", fromStatus: null, toStatus: "wired", amount: 200_000, createdAt: "2026-08-01T00:00:00.000Z" },
  ]);
  listPipeline.mockResolvedValue({ data: [{ id: "deal-1", ownerId: null, stage: "contacted", investor: { fullName: "Ada Investor", ventureFirm: "North VC" } }], meta: { page: 1, totalPages: 1 } });
  getFocus.mockResolvedValue([{ id: "deal-1", ownerId: null, stage: "contacted", isLead: true, reason: "missing", expectedAmount: 250_000, investor: { fullName: "Ada Investor", ventureFirm: "North VC" } }]);
  // meta matters: the round's tasks are paged through, not asked for in one
  // oversized request, so a mock without it never resolves a first page.
  listTasks.mockResolvedValue({
    data: [{ id: "task-1", pipelineId: "deal-1", assigneeId: "member-1", title: "Send the deck", dueDate: null, status: "open" }],
    meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
  });
});

describe("Today dashboard", () => {
  it("shows live assigned work, pipeline attention, and round progress", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><Dashboard /></QueryClientProvider></MemoryRouter>);

    expect(await screen.findByText("Send the deck")).toBeInTheDocument();
    expect(screen.getAllByText("Ada Investor").length).toBeGreaterThan(0);
    expect(screen.getByText("Unassigned deals")).toBeInTheDocument();
    expect(screen.getByText("$200,000")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("Funding progress")).toBeInTheDocument();
    expect(screen.getByText("Pipeline by stage")).toBeInTheDocument();
    expect(client.getQueryData(["pipeline", "startup-1", "round-1", null])).toMatchObject({
      data: [expect.objectContaining({ id: "deal-1" })],
    });
  });
});
