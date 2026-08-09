import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineEntry } from "../../lib/pipeline-api";
import type { PipelineStageId } from "../../lib/mock-data";

const listPipelineEntries = vi.fn();
vi.mock("../../lib/pipeline-api", () => ({
  listPipelineEntries: (...a: unknown[]) => listPipelineEntries(...a),
  createPipelineEntry: vi.fn(),
  updatePipelineEntry: vi.fn(),
  deletePipelineEntry: vi.fn(),
  getPipelineAnalytics: vi.fn(),
}));
vi.mock("../../lib/interaction-log-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/interaction-log-api")>()),
  listInteractionLogs: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
}));
vi.mock("../../lib/investor-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/investor-api")>()),
  listInvestors: vi.fn().mockResolvedValue({ data: [], meta: {} }),
}));
vi.mock("../../lib/team-api", () => ({ listMembers: vi.fn().mockResolvedValue([]) }));
vi.mock("../../hooks/useWorkspace", () => ({ useActiveStartupId: () => "startup-1" }));
vi.mock("../../hooks/usePermissions", async () => {
  const { roleCan } = await import("../../lib/permissions");
  return { usePermissions: () => ({ role: "owner", can: (r: never, a: never) => roleCan("owner", r, a) }) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

const { Pipeline } = await import("../../pages/dashboard/Pipeline/Pipeline");

function entry(overrides: Partial<PipelineEntry> = {}): PipelineEntry {
  const id = overrides.id ?? "deal-1";
  const investorId = overrides.investorId ?? "inv-1";
  return {
    id,
    startupId: "startup-1",
    investorId,
    stage: "sourced" as PipelineStageId,
    expectedAmount: 200000,
    probabilityPercentage: 10,
    stageChangedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
    investor: {
      id: investorId,
      startupId: "startup-1",
      fullName: "Ada Lovelace",
      email: null,
      ventureFirm: null,
      investorType: null,
      sectorFocus: null,
      investmentStagePreference: null,
      linkedinUrl: null,
      notes: null,
      source: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides.investor,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listPipelineEntries.mockResolvedValue({
    data: [entry({ id: "d1" })],
    meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
  });
});

describe("debug", () => {
  it("prints card html on dragstart", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Pipeline />
      </QueryClientProvider>,
    );
    await screen.findByText("Ada Lovelace");
    const card = screen.getByRole("button", { name: "Open Ada Lovelace" }).closest("[data-deal-card]")!;
    console.log("BEFORE:", card.className);
    console.log("draggable attr:", card.getAttribute("draggable"));
    fireEvent.dragStart(card, { dataTransfer: { setData: () => {}, getData: () => "" } });
    console.log("AFTER:", card.className);
    expect(true).toBe(true);
  });
});
