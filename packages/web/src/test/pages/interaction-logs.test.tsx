import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import type { InteractionLog } from "../../lib/interaction-log-api";
import type { InvestorListItem } from "../../lib/investor-api";

const listLogsForInvestor = vi.fn();
const createInteractionLog = vi.fn();
const updateInteractionLog = vi.fn();
const deleteInteractionLog = vi.fn();

vi.mock("../../lib/interaction-log-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/interaction-log-api")>()),
  listLogsForInvestor: (...a: unknown[]) => listLogsForInvestor(...a),
  createInteractionLog: (...a: unknown[]) => createInteractionLog(...a),
  updateInteractionLog: (...a: unknown[]) => updateInteractionLog(...a),
  deleteInteractionLog: (...a: unknown[]) => deleteInteractionLog(...a),
}));

const listMembers = vi.fn();
vi.mock("../../lib/team-api", () => ({ listMembers: () => listMembers() }));

let role = "owner";
vi.mock("../../hooks/usePermissions", async () => {
  const { roleCan } = await import("../../lib/permissions");
  return { usePermissions: () => ({ role, can: (r: never, a: never) => roleCan(role, r, a) }) };
});

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { InvestorDetailDialog } = await import(
  "../../pages/dashboard/Investors/InvestorDetailDialog"
);
const { mapContactToRow } = await import("../../pages/dashboard/Investors/investor-types");

const CONTACT: InvestorListItem = {
  id: "inv-1",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  pipeline: null,
  nextFollowupDate: null,
};

function log(overrides: Partial<InteractionLog> = {}): InteractionLog {
  return {
    id: "log-1",
    investorId: "inv-1",
    pipelineId: null,
    createdBy: "user-1",
    type: "call",
    subject: "Intro call",
    description: "Walked through the deck.",
    interactionDate: "2026-08-01T14:00:00.000Z",
    nextFollowupDate: null,
    followupCompletedAt: null,
    createdAt: "2026-08-01T14:05:00.000Z",
    ...overrides,
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

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InvestorDetailDialog
        startupId="startup-1"
        investor={mapContactToRow(CONTACT)}
        onOpenChange={() => {}}
        onEditInvestor={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  role = "owner";
  listLogsForInvestor.mockResolvedValue({
    data: [log()],
    meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
  });
  listMembers.mockResolvedValue([
    {
      id: "m1",
      status: "active",
      role: "owner",
      joinedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      user: {
        id: "user-1",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@acme.io",
        avatarUrl: null,
      },
    },
  ]);
});

describe("InvestorDetailDialog interaction history", () => {
  it("renders the timeline for the selected contact", async () => {
    renderDetail();

    expect(await screen.findByText("Intro call")).toBeInTheDocument();
    expect(screen.getByText("Walked through the deck.")).toBeInTheDocument();
    expect(listLogsForInvestor).toHaveBeenCalledWith(
      "startup-1",
      "inv-1",
      expect.objectContaining({ page: 1 }),
    );
  });

  it("resolves createdBy into a teammate's name rather than showing a uuid", async () => {
    renderDetail();

    await screen.findByText("Intro call");
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    expect(screen.queryByText(/user-1/)).not.toBeInTheDocument();
  });

  it("falls back gracefully when the author is no longer on the team", async () => {
    listLogsForInvestor.mockResolvedValue({
      data: [log({ createdBy: "departed-user" })],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    renderDetail();

    await screen.findByText("Intro call");
    expect(screen.getByText(/A teammate/)).toBeInTheDocument();
  });

  it("shows an empty state prompting the first entry", async () => {
    listLogsForInvestor.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });
    renderDetail();

    expect(await screen.findByText("Nothing logged yet")).toBeInTheDocument();
    expect(screen.getByText("Not contacted")).toBeInTheDocument();
  });

  it("logs an interaction with an ISO datetime", async () => {
    createInteractionLog.mockResolvedValue(log({ id: "log-2" }));
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText("Intro call");

    await user.click(screen.getByRole("button", { name: /log interaction/i }));
    await user.type(screen.getByLabelText("Subject"), "Follow-up");
    await user.click(screen.getByRole("button", { name: "Log interaction" }));

    await waitFor(() => expect(createInteractionLog).toHaveBeenCalled());
    const [, input] = createInteractionLog.mock.calls[0];
    expect(input.investorId).toBe("inv-1");
    expect(input.subject).toBe("Follow-up");
    // The form works in local time; the API is sent UTC.
    expect(input.interactionDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // An untouched optional field clears rather than sending an empty string.
    expect(input.nextFollowupDate).toBeNull();
  });

  it("edits an existing entry through the same dialog", async () => {
    updateInteractionLog.mockResolvedValue(log({ subject: "Renamed" }));
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText("Intro call");

    await user.click(screen.getByRole("button", { name: /Actions for Intro call/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    // The dialog opens populated from the entry being edited.
    expect(await screen.findByDisplayValue("Intro call")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateInteractionLog).toHaveBeenCalledWith(
        "startup-1",
        "log-1",
        expect.objectContaining({ subject: "Intro call" }),
      ),
    );
  });

  it("confirms before removing an entry", async () => {
    deleteInteractionLog.mockResolvedValue({ message: "removed" });
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText("Intro call");

    await user.click(screen.getByRole("button", { name: /Actions for Intro call/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByText("Remove this interaction?")).toBeInTheDocument();
    expect(deleteInteractionLog).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove interaction" }));
    await waitFor(() => expect(deleteInteractionLog).toHaveBeenCalledWith("startup-1", "log-1"));
  });

  it("explains a pipeline mismatch instead of the raw error", async () => {
    createInteractionLog.mockRejectedValue(
      apiError(422, "PIPELINE_MISMATCH", "Pipeline entry does not belong to this contact"),
    );
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText("Intro call");

    await user.click(screen.getByRole("button", { name: /log interaction/i }));
    await user.click(screen.getByRole("button", { name: "Log interaction" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "That pipeline entry belongs to a different contact.",
      ),
    );
  });

  it("gives a viewer read-only history", async () => {
    role = "viewer";
    renderDetail();
    await screen.findByText("Intro call");

    expect(screen.queryByRole("button", { name: /log interaction/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Actions for Intro call/ }),
    ).not.toBeInTheDocument();
  });
});
