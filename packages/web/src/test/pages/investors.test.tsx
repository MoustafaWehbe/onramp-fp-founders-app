import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import type { InvestorListItem } from "../../lib/investor-api";

const listInvestors = vi.fn();
const createInvestor = vi.fn();
const updateInvestor = vi.fn();
const deleteInvestor = vi.fn();

vi.mock("../../lib/investor-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/investor-api")>()),
  listInvestors: (...a: unknown[]) => listInvestors(...a),
  createInvestor: (...a: unknown[]) => createInvestor(...a),
  updateInvestor: (...a: unknown[]) => updateInvestor(...a),
  deleteInvestor: (...a: unknown[]) => deleteInvestor(...a),
}));

vi.mock("../../lib/pipeline-api", () => ({ createPipelineEntry: vi.fn() }));
vi.mock("../../hooks/useWorkspace", () => ({ useActiveStartupId: () => "startup-1" }));

let role = "owner";
vi.mock("../../hooks/usePermissions", async (importOriginal) => {
  const { roleCan } = await import("../../lib/permissions");
  void importOriginal;
  return {
    usePermissions: () => ({ role, can: (r: never, a: never) => roleCan(role, r, a) }),
  };
});

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { Investors } = await import("../../pages/dashboard/Investors/Investors");

function contact(id: string, fullName: string, inPipeline = false): InvestorListItem {
  return {
    id,
    startupId: "startup-1",
    fullName,
    email: `${id}@fund.com`,
    ventureFirm: "Acme Ventures",
    investorType: "vc",
    sectorFocus: "Fintech",
    investmentStagePreference: "Seed",
    linkedinUrl: null,
    notes: null,
    source: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pipeline: inPipeline
      ? { id: `p-${id}`, stage: "term_sheet", expectedAmount: 250000, probabilityPercentage: 60 }
      : null,
    nextFollowupDate: null,
    lastInteractionDate: null,
  };
}

function page(rows: InvestorListItem[], engaged = 2, prospect = 5) {
  return {
    data: rows,
    meta: {
      page: 1,
      limit: 25,
      total: rows.length,
      totalPages: 1,
      engagementCounts: { engaged, prospect },
    },
  };
}

function apiError(status: number, code: string, message: string) {
  return new AxiosError(message, String(status), undefined, null, {
    status,
    statusText: "",
    data: { code, error: message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

function renderInvestors() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Investors />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The most recent set of query params the page asked the API for. */
function lastQuery() {
  return listInvestors.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  role = "owner";
  listInvestors.mockResolvedValue(page([contact("i1", "Ada Lovelace", true)]));
});

describe("Investors", () => {
  it("opens on My investors and asks the API for engaged contacts only", async () => {
    renderInvestors();

    await waitFor(() => expect(listInvestors).toHaveBeenCalled());
    expect(lastQuery()).toMatchObject({ engagement: "engaged", page: 1 });
    expect(await screen.findAllByText("Ada Lovelace")).not.toHaveLength(0);
  });

  it("labels both tabs from the counts in one response", async () => {
    renderInvestors();

    // Wait for the response, not just the request — the badges start at 0.
    await screen.findAllByText("Ada Lovelace");
    const tabs = screen.getAllByRole("tab");
    expect(within(tabs[0]).getByText("2")).toBeInTheDocument();
    expect(within(tabs[1]).getByText("5")).toBeInTheDocument();
  });

  it("re-queries for prospects when the other tab is selected", async () => {
    const user = userEvent.setup();
    renderInvestors();
    await waitFor(() => expect(listInvestors).toHaveBeenCalled());

    await user.click(screen.getByRole("tab", { name: /Prospects/ }));

    await waitFor(() => expect(lastQuery()).toMatchObject({ engagement: "prospect" }));
  });

  it("drops the stage filter on the prospects tab, where it cannot apply", async () => {
    const user = userEvent.setup();
    renderInvestors();
    await waitFor(() => expect(listInvestors).toHaveBeenCalled());

    // Stage is only offered while viewing engaged contacts.
    expect(screen.getByRole("button", { name: "Stage" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Prospects/ }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stage" })).not.toBeInTheDocument(),
    );
    expect(lastQuery()).not.toHaveProperty("stage");
  });

  it("sends the search to the API instead of filtering in memory", async () => {
    const user = userEvent.setup();
    renderInvestors();
    await waitFor(() => expect(listInvestors).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Search investors"), "accel");

    await waitFor(() => expect(lastQuery()).toMatchObject({ search: "accel" }), {
      timeout: 2000,
    });
  });

  it("creates an investor from the add dialog", async () => {
    createInvestor.mockResolvedValue({ ...contact("new", "Grace Hopper") });
    const user = userEvent.setup();
    renderInvestors();
    await waitFor(() => expect(listInvestors).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /add investor/i }));
    await user.type(screen.getByLabelText("Full name"), "Grace Hopper");
    await user.click(screen.getByRole("button", { name: "Add investor" }));

    await waitFor(() =>
      expect(createInvestor).toHaveBeenCalledWith(
        "startup-1",
        expect.objectContaining({ fullName: "Grace Hopper" }),
      ),
    );
  });

  it("sends blank optional fields as null so they can be cleared", async () => {
    createInvestor.mockResolvedValue({ ...contact("new", "Grace Hopper") });
    const user = userEvent.setup();
    renderInvestors();
    await waitFor(() => expect(listInvestors).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /add investor/i }));
    await user.type(screen.getByLabelText("Full name"), "Grace Hopper");
    await user.click(screen.getByRole("button", { name: "Add investor" }));

    await waitFor(() => expect(createInvestor).toHaveBeenCalled());
    const [, input] = createInvestor.mock.calls[0];
    expect(input.email).toBeNull();
    expect(input.ventureFirm).toBeNull();
    expect(input.investorType).toBeNull();
  });

  it("explains a duplicate email rather than showing the raw error", async () => {
    createInvestor.mockRejectedValue(
      apiError(409, "DUPLICATE_EMAIL", "This startup already has a contact with that email"),
    );
    const user = userEvent.setup();
    renderInvestors();
    await waitFor(() => expect(listInvestors).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /add investor/i }));
    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@fund.com");
    await user.click(screen.getByRole("button", { name: "Add investor" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Another contact in this workspace already uses that email.",
      ),
    );
  });

  it("confirms before deleting, and explains when the API refuses", async () => {
    deleteInvestor.mockRejectedValue(
      apiError(409, "HAS_DEPENDENTS", "This contact has pipeline entries"),
    );
    const user = userEvent.setup();
    renderInvestors();
    await screen.findAllByText("Ada Lovelace");

    await user.click(screen.getAllByRole("button", { name: "Actions for Ada Lovelace" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: /delete investor/i }));

    expect(await screen.findByText("Delete Ada Lovelace?")).toBeInTheDocument();
    expect(deleteInvestor).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete investor" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This contact has pipeline entries, commitments or logged interactions, so it can't be deleted.",
      ),
    );
  });

  it("gives a viewer no way to add, edit or delete", async () => {
    role = "viewer";
    const user = userEvent.setup();
    renderInvestors();
    await screen.findAllByText("Ada Lovelace");

    expect(screen.queryByRole("button", { name: /add investor/i })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Actions for Ada Lovelace" })[0]);
    expect(screen.queryByRole("menuitem", { name: /edit details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /delete investor/i })).not.toBeInTheDocument();
  });
});
