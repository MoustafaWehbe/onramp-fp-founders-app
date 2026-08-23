import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getReviewerInvitationAnalytics = vi.fn();
const listReviewerInvitationActivity = vi.fn();

vi.mock("../../lib/reviewer-api", () => ({
  getReviewerInvitationAnalytics: (...args: unknown[]) => getReviewerInvitationAnalytics(...args),
  listReviewerInvitationActivity: (...args: unknown[]) => listReviewerInvitationActivity(...args),
  reviewerDocumentContextHref: () => "/documents",
  reviewerStatusClass: () => "",
}));

const { ReviewerAnalyticsSheet } = await import("../../pages/dashboard/ReviewerAnalyticsSheet");

beforeEach(() => {
  vi.clearAllMocks();
  getReviewerInvitationAnalytics.mockResolvedValue({
    invitation: {
      reviewerName: "Ada Investor",
      email: "ada@example.com",
      status: "opened",
      requireNda: false,
      hasPassword: false,
      allowPrint: false,
    },
    forwarding: { suspected: false, distinctDevices: 1, distinctIps: 1 },
    summary: {
      visitCount: 0,
      totalActiveMs: 0,
      lastSeenAt: null,
      completionPct: 0,
    },
    documents: [],
    visits: [],
    security: { counts: {}, recent: [] },
  });
  listReviewerInvitationActivity.mockImplementation(
    (_startupId: string, _invitationId: string, options: { cursor?: string }) =>
      options.cursor
        ? Promise.resolve({
            data: [
              {
                id: "invitation-created-1",
                type: "invitation_created",
                occurredAt: "2026-08-20T09:00:00.000Z",
                document: null,
                pageNumber: null,
                details: {},
              },
            ],
            pagination: { hasMore: false, nextCursor: null },
          })
        : Promise.resolve({
            data: [
              {
                id: "invitation-sent-1",
                type: "invitation_sent",
                occurredAt: "2026-08-20T10:00:00.000Z",
                document: null,
                pageNumber: null,
                details: {},
              },
            ],
            pagination: { hasMore: true, nextCursor: "older_cursor" },
          }),
  );
});

describe("ReviewerAnalyticsSheet", () => {
  it("loads earlier activity without replacing the newest events", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ReviewerAnalyticsSheet
            startupId="startup-1"
            invitationId="invitation-1"
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Invitation email sent")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load earlier activity" }));

    expect(await screen.findByText("Invitation created")).toBeInTheDocument();
    expect(screen.getByText("Invitation email sent")).toBeInTheDocument();
    expect(listReviewerInvitationActivity).toHaveBeenLastCalledWith(
      "startup-1",
      "invitation-1",
      { limit: 25, cursor: "older_cursor" },
    );
  });
});
