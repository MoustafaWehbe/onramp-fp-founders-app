import { AxiosError, AxiosHeaders } from "axios";
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
vi.mock("../../lib/fundraising-api", async (importOriginal) => ({
  // Keep the real status vocabularies and labels — the round picker and the
  // commit prompt render from them.
  ...(await importOriginal<typeof import("../../lib/fundraising-api")>()),
  listFundraisingRounds: (...a: unknown[]) => listFundraisingRounds(...a),
}));

vi.mock("../../lib/investor-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/investor-api")>()),
  listInvestors: vi.fn().mockResolvedValue({ data: [], meta: {} }),
}));

const listMembers = vi.fn();
vi.mock("../../lib/team-api", () => ({ listMembers: (...a: unknown[]) => listMembers(...a) }));
vi.mock("../../hooks/useWorkspace", () => ({ useActiveStartupId: () => "startup-1" }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

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
    isLead: false,
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
  listMembers.mockResolvedValue([
    {
      id: "member-1",
      status: "active",
      role: "owner",
      joinedAt: null,
      createdAt: daysFromNow(-30),
      user: {
        id: "user-1",
        firstName: "Ada",
        lastName: "Founder",
        email: "founder@example.com",
        avatarUrl: null,
      },
    },
    {
      id: "member-2",
      status: "active",
      role: "collaborator",
      joinedAt: null,
      createdAt: daysFromNow(-30),
      user: {
        id: "user-2",
        firstName: "Grace",
        lastName: "Hopper",
        email: "grace@example.com",
        avatarUrl: null,
      },
    },
  ]);
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

  // "Do we have a lead yet?" is the most-asked question about any raise, and
  // the board is where a founder looks at the whole thing at once.
  describe("the round lead", () => {
    it("says so plainly when no deal is marked as leading", async () => {
      renderPipeline();

      expect(await screen.findByText("No lead yet")).toBeInTheDocument();
    });

    it("names the lead once one is marked", async () => {
      listPipelineEntries.mockResolvedValue({
        data: [
          entry({ id: "d1", investorId: "i1", isLead: true }),
          entry({ id: "d2", investorId: "i2" }),
        ],
        meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
      });
      renderPipeline();

      expect(await screen.findByText("Lead: Ada Lovelace")).toBeInTheDocument();
      expect(screen.queryByText("No lead yet")).not.toBeInTheDocument();
    });

    it("does not count an investor who passed as the lead", async () => {
      listPipelineEntries.mockResolvedValue({
        data: [entry({ id: "d1", investorId: "i1", isLead: true, stage: "passed" })],
        meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
      renderPipeline();

      expect(await screen.findByText("No lead yet")).toBeInTheDocument();
    });
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

    // Regression: the reason prompt used to exist only in the deal sheet, so
    // moving a card to Passed from the board sent no reason and the server
    // rejected it with PASSED_REASON_REQUIRED.
    it("asks for a reason before passing a deal from the card menu", async () => {
      const user = userEvent.setup();
      renderPipeline();
      await screen.findByText("Ada Lovelace");

      await user.click(screen.getByRole("button", { name: "Move Ada Lovelace to another stage" }));
      await user.click(await screen.findByRole("menuitem", { name: /Passed/ }));

      expect(
        await screen.findByRole("heading", { name: /Why did Ada Lovelace pass\?/ }),
      ).toBeInTheDocument();
      // Nothing is written until a reason is given.
      expect(updatePipelineEntry).not.toHaveBeenCalled();

      updatePipelineEntry.mockResolvedValue(entry({ stage: "passed" }));
      await user.click(screen.getByRole("button", { name: "Timing" }));
      await user.click(screen.getByRole("button", { name: "Mark as passed" }));

      await waitFor(() =>
        expect(updatePipelineEntry).toHaveBeenCalledWith(
          "startup-1",
          "d1",
          expect.objectContaining({ stage: "passed", reason: "Timing" }),
        ),
      );
    });

    // A deal reaching Committed and money landing in the round are the same
    // event; the board used to record only the stage, so the round page
    // showed nothing for an investor the board called committed.
    it("records a commitment against the round when a deal is moved to Committed", async () => {
      const user = userEvent.setup();
      renderPipeline();
      await screen.findByText("Ada Lovelace");

      await user.click(screen.getByRole("button", { name: "Move Ada Lovelace to another stage" }));
      await user.click(await screen.findByRole("menuitem", { name: /Committed/ }));

      const prompt = await screen.findByRole("dialog");
      expect(
        within(prompt).getByRole("heading", { name: /Record Ada Lovelace's commitment/ }),
      ).toBeInTheDocument();
      // Seeded from the deal's expected amount so the common case is one click.
      expect(within(prompt).getByLabelText("Amount")).toHaveValue(200000);
      expect(updatePipelineEntry).not.toHaveBeenCalled();

      // The status picker is the shared Radix listbox, not a native <select>.
      await user.click(within(prompt).getByRole("combobox", { name: /Status/ }));
      // Hard-circled means the docs are signed — the point at which the money
      // is allowed to count toward the round's target.
      await user.click(await screen.findByRole("option", { name: "Hard-circled" }));

      updatePipelineEntry.mockResolvedValue(entry({ stage: "committed" }));
      await user.click(within(prompt).getByRole("button", { name: "Record commitment" }));

      await waitFor(() =>
        expect(updatePipelineEntry).toHaveBeenCalledWith(
          "startup-1",
          "d1",
          expect.objectContaining({
            stage: "committed",
            commitment: expect.objectContaining({ amount: 200000, status: "hard_circled" }),
          }),
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

  // Logs belong to the investor, not the deal, so the same contact's calls
  // from another round turn up here. Showing them is useful; presenting them
  // as this deal's history is not.
  it("marks logs that belong to a different deal with the same investor", async () => {
    listLogsForInvestor.mockResolvedValue({
      data: [
        log({ id: "log-here", pipelineId: "deal-1", subject: "This deal's call" }),
        log({ id: "log-elsewhere", pipelineId: "deal-9", subject: "Series A call" }),
        log({ id: "log-loose", pipelineId: null, subject: "Unattached note" }),
      ],
      meta: { page: 1, limit: 50, total: 3, totalPages: 1 },
    });
    const user = userEvent.setup();
    renderPipeline();

    await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));
    await screen.findByRole("heading", { name: "Interaction history" });

    // Exactly one badge: the loose log is relationship-level and belongs in
    // every timeline for this investor without qualification.
    const badges = screen.getAllByText("Another deal");
    expect(badges).toHaveLength(1);
    expect(screen.getByText("Series A call")).toBeInTheDocument();
    expect(screen.getByText("Unattached note")).toBeInTheDocument();
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

  // A deal in a round that later closes was previously stranded — the only
  // way out was delete-and-recreate, which destroys its stage history.
  describe("carrying a deal into another round", () => {
    beforeEach(() => {
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
          {
            id: "round-2",
            startupId: "startup-1",
            roundName: "Series A",
            targetAmount: 5_000_000,
            minimumTicketSize: null,
            equityOfferedPercentage: null,
            currency: "USD",
            status: "draft",
            createdAt: daysFromNow(-5),
            updatedAt: daysFromNow(-5),
          },
          {
            id: "round-3",
            startupId: "startup-1",
            roundName: "Pre-seed",
            targetAmount: 250_000,
            minimumTicketSize: null,
            equityOfferedPercentage: null,
            currency: "USD",
            status: "closed",
            createdAt: daysFromNow(-200),
            updatedAt: daysFromNow(-200),
          },
        ],
        meta: { page: 1, limit: 100, total: 3, totalPages: 1 },
      });
    });

    it("offers only rounds that can still take the deal", async () => {
      const user = userEvent.setup();
      renderPipeline();

      await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox", { name: /Round/ }));

      expect(await screen.findByRole("option", { name: /Series A/ })).toBeInTheDocument();
      // Closed, and not the round this deal is already in.
      expect(screen.queryByRole("option", { name: /Pre-seed/ })).not.toBeInTheDocument();
    });

    it("moves the deal and closes the sheet, which no longer shows it", async () => {
      updatePipelineEntry.mockResolvedValue(entry({ roundId: "round-2" }));
      const user = userEvent.setup();
      renderPipeline();

      await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox", { name: /Round/ }));
      await user.click(await screen.findByRole("option", { name: /Series A/ }));

      await waitFor(() =>
        expect(updatePipelineEntry).toHaveBeenCalledWith("startup-1", "deal-1", {
          roundId: "round-2",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("explains that commitments pin a deal to its round", async () => {
      updatePipelineEntry.mockRejectedValue(
        new AxiosError("Conflict", "409", undefined, null, {
          status: 409,
          statusText: "",
          data: { code: "HAS_DEPENDENTS", error: "Conflict" },
          headers: {},
          config: { headers: new AxiosHeaders() },
        }),
      );
      const user = userEvent.setup();
      renderPipeline();

      await user.click(await screen.findByRole("button", { name: "Open Ada Lovelace" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox", { name: /Round/ }));
      await user.click(await screen.findByRole("option", { name: /Series A/ }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("commitments recorded against its round"),
        ),
      );
    });
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

  // Tasks used to be reachable only by opening the one deal that owned them,
  // so work assigned to you was invisible unless you knew where to look.
  describe("the Tasks tab", () => {
    beforeEach(() => {
      listPipelineEntries.mockResolvedValue({
        data: [entry({ id: "d1", investorId: "i1" })],
        meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
      listTasks.mockResolvedValue({
        data: [
          {
            id: "t1",
            startupId: "startup-1",
            pipelineId: "d1",
            title: "Send the updated deck",
            description: null,
            status: "open",
            priority: "high",
            dueDate: daysFromNow(-2),
            assigneeId: "member-1",
            completedAt: null,
            createdBy: "user-1",
            createdAt: daysFromNow(-5),
            updatedAt: daysFromNow(-5),
          },
          {
            id: "t2",
            startupId: "startup-1",
            pipelineId: "d1",
            title: "Grace's intro email",
            description: null,
            status: "open",
            priority: "medium",
            dueDate: null,
            assigneeId: "member-2",
            completedAt: null,
            createdBy: "user-1",
            createdAt: daysFromNow(-5),
            updatedAt: daysFromNow(-5),
          },
        ],
        meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
      });
    });

    it("asks the server for the round's open tasks rather than paging per deal", async () => {
      const user = userEvent.setup();
      renderPipeline();
      await screen.findByText("Ada Lovelace");

      await user.click(screen.getByRole("tab", { name: /Tasks/ }));

      await waitFor(() =>
        expect(listTasks).toHaveBeenCalledWith(
          "startup-1",
          expect.objectContaining({ roundId: "round-1", status: "open" }),
        ),
      );
    });

    it("shows only your own work until you ask for everyone's", async () => {
      const user = userEvent.setup();
      renderPipeline();
      await screen.findByText("Ada Lovelace");

      await user.click(screen.getByRole("tab", { name: /Tasks/ }));

      // Defaults to the signed-in user's member row, matched through their
      // user id — tasks carry a StartupMember id, not a user id.
      expect(await screen.findByText("Send the updated deck")).toBeInTheDocument();
      expect(screen.queryByText("Grace's intro email")).not.toBeInTheDocument();
      expect(screen.getByText("Overdue 2d")).toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: /Everyone/ }));

      expect(await screen.findByText("Grace's intro email")).toBeInTheDocument();
      expect(screen.getByText("Send the updated deck")).toBeInTheDocument();
    });

    it("completes a task straight from the queue", async () => {
      const user = userEvent.setup();
      renderPipeline();
      await screen.findByText("Ada Lovelace");

      await user.click(screen.getByRole("tab", { name: /Tasks/ }));
      await user.click(await screen.findByRole("checkbox", { name: /Complete task Send the updated deck/ }));

      await waitFor(() => expect(updateTask).toHaveBeenCalledWith("startup-1", "t1", "completed"));
    });
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
