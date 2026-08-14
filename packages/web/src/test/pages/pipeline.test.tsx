import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InteractionLog } from "../../lib/interaction-log-api";
import type { PipelineEntry, PipelineFocusEntry } from "../../lib/pipeline-api";
import type { PipelineStageId } from "../../lib/mock-data";

const listPipelineEntries = vi.fn();
const createPipelineEntry = vi.fn();
const updatePipelineEntry = vi.fn();
const deletePipelineEntry = vi.fn();
const getPipelineFocus = vi.fn();

vi.mock("../../lib/pipeline-api", () => ({
  listPipelineEntries: (...a: unknown[]) => listPipelineEntries(...a),
  createPipelineEntry: (...a: unknown[]) => createPipelineEntry(...a),
  updatePipelineEntry: (...a: unknown[]) => updatePipelineEntry(...a),
  deletePipelineEntry: (...a: unknown[]) => deletePipelineEntry(...a),
  getPipelineAnalytics: (...a: unknown[]) => getPipelineAnalytics(...a),
  getPipelineFocus: (...a: unknown[]) => getPipelineFocus(...a),
}));

const listInteractionLogs = vi.fn();
const listLogsForInvestor = vi.fn();
const createInteractionLog = vi.fn();
const updateInteractionLog = vi.fn();
vi.mock("../../lib/interaction-log-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/interaction-log-api")>()),
  listInteractionLogs: (...a: unknown[]) => listInteractionLogs(...a),
  listLogsForInvestor: (...a: unknown[]) => listLogsForInvestor(...a),
  createInteractionLog: (...a: unknown[]) => createInteractionLog(...a),
  updateInteractionLog: (...a: unknown[]) => updateInteractionLog(...a),
  deleteInteractionLog: vi.fn(),
}));

const listTasks = vi.fn();
const createTask = vi.fn();
const updateTask = vi.fn();
const deleteTask = vi.fn();
vi.mock("../../lib/task-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/task-api")>()),
  listTasks: (...a: unknown[]) => listTasks(...a),
  createTask: (...a: unknown[]) => createTask(...a),
  updateTask: (...a: unknown[]) => updateTask(...a),
  deleteTask: (...a: unknown[]) => deleteTask(...a),
  setTaskStatus: (...a: unknown[]) => updateTask(...a),
}));

const getPipelineAnalytics = vi.fn();

const listFundraisingRounds = vi.fn();
vi.mock("../../lib/fundraising-api", () => ({
  listFundraisingRounds: (...a: unknown[]) => listFundraisingRounds(...a),
}));

vi.mock("../../lib/investor-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/investor-api")>()),
  listInvestors: vi.fn().mockResolvedValue({ data: [], meta: {} }),
}));

vi.mock("../../lib/team-api", () => ({ listMembers: vi.fn().mockResolvedValue([]) }));
vi.mock("../../hooks/useWorkspace", () => ({ useActiveStartupId: () => "startup-1" }));

let role = "owner";
vi.mock("../../hooks/usePermissions", async () => {
  const { roleCan } = await import("../../lib/permissions");
  return { usePermissions: () => ({ role, can: (r: never, a: never) => roleCan(role, r, a) }) };
});

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { Pipeline } = await import("../../pages/dashboard/Pipeline/Pipeline");

const NOW = new Date("2026-08-09T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * DAY).toISOString();
}

function entry(overrides: Partial<PipelineEntry> = {}): PipelineEntry {
  const id = overrides.id ?? "deal-1";
  const investorId = overrides.investorId ?? "inv-1";
  return {
    id,
    startupId: "startup-1",
    roundId: "round-1",
    investorId,
    stage: "contacted" as PipelineStageId,
    expectedAmount: 200_000,
    probabilityPercentage: 25,
    ownerId: null,
    priority: null,
    investorFitScore: null,
    sortOrder: 1000,
    stageChangedAt: daysFromNow(-3),
    createdAt: daysFromNow(-3),
    updatedAt: daysFromNow(-3),
    ...overrides,
    investor: {
      id: investorId,
      startupId: "startup-1",
      fullName: "Ada Lovelace",
      email: "ada@fund.com",
      ventureFirm: "Acme Ventures",
      investorType: "vc",
      sectorFocus: "Fintech",
      investmentStagePreference: "Seed",
      linkedinUrl: null,
      notes: null,
      source: "Warm intro",
      createdAt: daysFromNow(-10),
      updatedAt: daysFromNow(-10),
      ...overrides.investor,
    },
  };
}

/** A focus row is a full pipeline entry plus the server-computed attention fields. */
function focusEntry(overrides: Partial<PipelineFocusEntry> = {}): PipelineFocusEntry {
  const { reason, daysQuiet, nextTaskDueDate, ...entryOverrides } = overrides;
  return {
    ...entry(entryOverrides),
    reason: reason ?? "overdue",
    daysQuiet: daysQuiet ?? 0,
    nextTaskDueDate: nextTaskDueDate ?? null,
  };
}

function log(overrides: Partial<InteractionLog> = {}): InteractionLog {
  return {
    id: "log-1",
    investorId: "inv-1",
    pipelineId: "deal-1",
    createdBy: "user-1",
    type: "call",
    subject: "Intro call",
    description: "Walked through the deck.",
    interactionDate: daysFromNow(-2),
    nextFollowupDate: null,
    followupCompletedAt: null,
    createdAt: daysFromNow(-2),
    ...overrides,
  };
}

function renderPipeline() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Pipeline />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  role = "owner";
  listFundraisingRounds.mockResolvedValue({
    data: [
      {
        id: "round-1",
        startupId: "startup-1",
        roundName: "Seed",
        targetAmount: 1_000_000,
        minimumTicketSize: null,
        equityOfferedPercentage: null,
        currency: "USD",
        status: "active",
        createdAt: daysFromNow(-30),
        updatedAt: daysFromNow(-30),
      },
    ],
    meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
  });
  listPipelineEntries.mockResolvedValue({
    data: [entry()],
    meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
  });
  listInteractionLogs.mockResolvedValue({
    data: [log()],
    meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
  });
  listLogsForInvestor.mockResolvedValue({
    data: [log()],
    meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
  });
  getPipelineAnalytics.mockResolvedValue({
    totalDeals: 0,
    funnel: [],
    conversion: [],
    outcomes: { open: 0, committed: 0, passed: 0, winRate: null },
  });
  getPipelineFocus.mockResolvedValue([]);
  listTasks.mockResolvedValue({
    data: [],
    meta: { page: 1, limit: 100, total: 0, totalPages: 0 },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Pipeline board", () => {
  it("summarises live, weighted and committed value across the board", async () => {
    listPipelineEntries.mockResolvedValue({
      data: [
        entry({ id: "d1", investorId: "i1", stage: "contacted", expectedAmount: 200_000, probabilityPercentage: 25 }),
        entry({ id: "d2", investorId: "i2", stage: "committed", expectedAmount: 300_000, probabilityPercentage: 90 }),
        // Passed deals are excluded from every forecast number.
        entry({ id: "d3", investorId: "i3", stage: "passed", expectedAmount: 500_000, probabilityPercentage: 0 }),
      ],
      meta: { page: 1, limit: 100, total: 3, totalPages: 1 },
    });
    renderPipeline();

    const summary = within(await screen.findByLabelText("Pipeline summary"));
    // 200k + 300k live; the 500k passed deal is left out of every total.
    expect(summary.getByText("$500k")).toBeInTheDocument();
    // 200k × 0.25 + 300k × 0.9 = 320k
    expect(summary.getByText("$320k")).toBeInTheDocument();
    expect(summary.getByText("$300k")).toBeInTheDocument();
  });

  it("flags an overdue task on the card and counts it as needing attention", async () => {
    getPipelineFocus.mockResolvedValue([
      focusEntry({ reason: "overdue", nextTaskDueDate: daysFromNow(-4) }),
    ]);
    renderPipeline();

    expect(await screen.findByText("Task overdue")).toBeInTheDocument();
    const attention = screen.getByRole("button", { name: /Needs attention/ });
    expect(within(attention).getByText("1")).toBeInTheDocument();
  });

  it("treats a live deal with no open task as needing attention", async () => {
    listInteractionLogs.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 0 },
    });
    listPipelineEntries.mockResolvedValue({
      data: [entry({ createdAt: daysFromNow(-30), updatedAt: daysFromNow(-30) })],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    getPipelineFocus.mockResolvedValue([
      focusEntry({ createdAt: daysFromNow(-30), reason: "missing" }),
    ]);
    renderPipeline();

    expect(await screen.findByText("No next step")).toBeInTheDocument();
    expect(screen.getByText("Never contacted")).toBeInTheDocument();
  });

  it("filters the board down to deals needing attention", async () => {
    getPipelineFocus.mockResolvedValue([
      focusEntry({ id: "d1", investorId: "i1", reason: "overdue", nextTaskDueDate: daysFromNow(-4) }),
    ]);
    listPipelineEntries.mockResolvedValue({
      data: [
        entry({ id: "d1", investorId: "i1" }),
        entry({
          id: "d2",
          investorId: "i2",
          stage: "due_diligence",
          investor: { fullName: "Grace Hopper" } as PipelineEntry["investor"],
        }),
      ],
      meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });
    const user = userEvent.setup();
    renderPipeline();

    await screen.findByText("Grace Hopper");
    await user.click(screen.getByRole("button", { name: /Needs attention/ }));

    expect(screen.queryByText("Grace Hopper")).not.toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("searches by investor and firm without hitting the API again", async () => {
    listPipelineEntries.mockResolvedValue({
      data: [
        entry({ id: "d1", investorId: "i1" }),
        entry({
          id: "d2",
          investorId: "i2",
          investor: {
            fullName: "Grace Hopper",
            ventureFirm: "Northwind",
          } as PipelineEntry["investor"],
        }),
      ],
      meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });
    const user = userEvent.setup();
    renderPipeline();

    await screen.findByText("Grace Hopper");
    await user.type(screen.getByLabelText("Search the pipeline"), "northwind");

    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(listPipelineEntries).toHaveBeenCalledTimes(1);
  });

  // The board moves cards via dnd-kit (pointer-based drag, real
  // getBoundingClientRect measurement for collision detection), which jsdom
  // can't meaningfully simulate — there's no layout engine behind it. The
  // reordering/column math itself is covered directly, without any DOM, in
  // src/test/pages/board-columns.test.ts. Here we only exercise the
  // non-drag path to the same mutation: the card's own "move to stage" menu.
  describe("moving a deal without dragging", () => {
    beforeEach(() => {
      listPipelineEntries.mockResolvedValue({
        data: [
          entry({
            id: "d1",
            investorId: "i1",
            stage: "sourced",
            sortOrder: 1000,
            investor: { fullName: "Ada Lovelace" } as PipelineEntry["investor"],
          }),
        ],
        meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
    });

    it("moves a card to a new stage from its own menu, landing at the bottom of that column", async () => {
      updatePipelineEntry.mockResolvedValue(entry({ stage: "contacted" }));
      const user = userEvent.setup();
      renderPipeline();
      await screen.findByText("Ada Lovelace");

      await user.click(screen.getByRole("button", { name: "Move Ada Lovelace to another stage" }));
      await user.click(await screen.findByRole("menuitem", { name: /Contacted/ }));

      await waitFor(() =>
        expect(updatePipelineEntry).toHaveBeenCalledWith(
          "startup-1",
          "d1",
          expect.objectContaining({ stage: "contacted", sortOrder: 1000 }),
        ),
      );
    });
  });

  it("opens a deal and shows its interaction history", async () => {
    const user = userEvent.setup();
    renderPipeline();

    await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));

    expect(await screen.findByRole("heading", { name: "Interaction history" })).toBeInTheDocument();
    expect(screen.getByText("Walked through the deck.")).toBeInTheDocument();
    expect(listLogsForInvestor).toHaveBeenCalledWith(
      "startup-1",
      "inv-1",
      expect.objectContaining({ page: 1 }),
    );
  });

  it("moves a stage from the detail dialog and resets the probability", async () => {
    updatePipelineEntry.mockResolvedValue(entry({ stage: "term_sheet" }));
    const user = userEvent.setup();
    renderPipeline();

    await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Term sheet/ }));

    await waitFor(() =>
      expect(updatePipelineEntry).toHaveBeenCalledWith("startup-1", "deal-1", {
        stage: "term_sheet",
        probabilityPercentage: 80,
      }),
    );
  });

  it("saves an edited expected amount when the field loses focus", async () => {
    updatePipelineEntry.mockResolvedValue(entry({ expectedAmount: 350_000 }));
    const user = userEvent.setup();
    renderPipeline();

    await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));
    const amount = await screen.findByLabelText("Expected amount");
    await user.clear(amount);
    await user.type(amount, "350000");
    await user.tab();

    await waitFor(() =>
      expect(updatePipelineEntry).toHaveBeenCalledWith("startup-1", "deal-1", {
        expectedAmount: 350000,
      }),
    );
  });

  it("confirms before removing a deal from the board", async () => {
    deletePipelineEntry.mockResolvedValue({ message: "removed" });
    const user = userEvent.setup();
    renderPipeline();

    await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));
    await user.click(await screen.findByRole("button", { name: /Remove from pipeline/ }));

    expect(
      await screen.findByText("Remove Ada Lovelace from the pipeline?"),
    ).toBeInTheDocument();
    expect(deletePipelineEntry).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove from pipeline" }));
    await waitFor(() => expect(deletePipelineEntry).toHaveBeenCalledWith("startup-1", "deal-1"));
  });

  it("does not flag a deal the server left out of the focus list", async () => {
    // A completed task, or none at all past the quiet threshold, means the
    // deal simply never appears in getPipelineFocus's response.
    getPipelineFocus.mockResolvedValue([]);
    renderPipeline();

    await screen.findByText("Ada Lovelace");
    expect(screen.queryByText("Task overdue")).not.toBeInTheDocument();
    const attention = screen.getByRole("button", { name: /Needs attention/ });
    expect(within(attention).getByText("0")).toBeInTheDocument();
  });

  it("uses stageChangedAt for time-in-stage, not updatedAt", async () => {
    listPipelineEntries.mockResolvedValue({
      data: [
        entry({
          stageChangedAt: daysFromNow(-40),
          // An amount edit today moves updatedAt but must not reset the clock.
          updatedAt: daysFromNow(0),
        }),
      ],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    const user = userEvent.setup();
    renderPipeline();

    await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("In stage")).toBeInTheDocument();
    expect(within(dialog).getByText("1 mo")).toBeInTheDocument();
  });

  it("logs an interaction straight from the focus list against the deal", async () => {
    getPipelineFocus.mockResolvedValue([
      focusEntry({ reason: "overdue", nextTaskDueDate: daysFromNow(-4) }),
    ]);
    createInteractionLog.mockResolvedValue(log({ id: "log-2" }));
    const user = userEvent.setup();
    renderPipeline();

    await user.click(await screen.findByRole("tab", { name: /Focus/ }));
    await user.click(await screen.findByRole("button", { name: "Log" }));
    await user.click(await screen.findByRole("button", { name: "Log interaction" }));

    await waitFor(() => expect(createInteractionLog).toHaveBeenCalled());
    const [, input] = createInteractionLog.mock.calls[0];
    expect(input).toMatchObject({ investorId: "inv-1", pipelineId: "deal-1" });
  });

  it("tells you when nothing needs chasing", async () => {
    const user = userEvent.setup();
    renderPipeline();

    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("tab", { name: /Focus/ }));

    expect(await screen.findByText("Nothing needs chasing")).toBeInTheDocument();
  });

  it("loads analytics only once the tab is opened", async () => {
    getPipelineAnalytics.mockResolvedValue({
      totalDeals: 3,
      funnel: [
        { stage: "contacted", current: 1, currentValue: 200000, everReached: 3, medianDaysInStage: 6 },
        { stage: "meeting_scheduled", current: 0, currentValue: 0, everReached: 2, medianDaysInStage: null },
      ],
      conversion: [
        { fromStage: "contacted", toStage: "meeting_scheduled", reached: 3, advanced: 2, rate: 2 / 3 },
      ],
      outcomes: { open: 1, committed: 1, passed: 1, winRate: 0.5 },
    });
    const user = userEvent.setup();
    renderPipeline();

    await screen.findByText("Ada Lovelace");
    expect(getPipelineAnalytics).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: /Analytics/ }));

    await screen.findByText("Stage conversion");
    // Funnel and the detail grid both render a conversion rate, so scope to
    // the grid to avoid matching both.
    const conversionSection = within(screen.getByLabelText("Conversion"));
    expect(conversionSection.getByText("67%")).toBeInTheDocument();
    expect(conversionSection.getByText("2 of 3")).toBeInTheDocument();
    // Win rate over decided deals only: 1 committed / (1 committed + 1 passed).
    expect(screen.getByText("50%")).toBeInTheDocument();

    // The funnel itself renders every non-passed stage with its reach count.
    expect(
      screen.getByLabelText("Contacted: 3 deals ever reached this stage"),
    ).toBeInTheDocument();
  });

  it("gives a viewer a read-only board", async () => {
    role = "viewer";
    const user = userEvent.setup();
    renderPipeline();

    await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));

    expect(screen.queryByRole("button", { name: /Add to pipeline/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Move Ada Lovelace to another stage/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove from pipeline/ })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Expected amount")).toBeDisabled();
  });
});
