import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestReviewerAccess = vi.fn();
const verifyReviewerAccess = vi.fn();

vi.mock("../../lib/reviewer-portal-api", () => ({
  requestReviewerAccess: (...args: unknown[]) => requestReviewerAccess(...args),
  verifyReviewerAccess: (...args: unknown[]) => verifyReviewerAccess(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { ReviewerAccess } = await import("../../pages/review/ReviewerAccess");

beforeEach(() => {
  vi.clearAllMocks();
  requestReviewerAccess
    .mockResolvedValueOnce({
      challengeId: "00000000-0000-0000-0000-000000000001",
      emailHint: "ad***@example.com",
      expiresInSeconds: 600,
    })
    .mockResolvedValueOnce({
      challengeId: "00000000-0000-0000-0000-000000000002",
      emailHint: "ad***@example.com",
      expiresInSeconds: 600,
    });
  verifyReviewerAccess.mockResolvedValue({ session: { id: "session-1" } });
});

describe("ReviewerAccess", () => {
  it("binds verification to the newest challenge after a resend", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/raw-invitation-token"]}>
        <Routes>
          <Route path="/review/:token" element={<ReviewerAccess />} />
          <Route path="/review/workspace" element={<div>Reviewer workspace</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Email me a verification code" }));
    expect(await screen.findByText(/ad\*\*\*@example\.com/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resend code" }));
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(verifyReviewerAccess).toHaveBeenCalledWith(
      "raw-invitation-token",
      "00000000-0000-0000-0000-000000000002",
      "123456",
    );
    expect(await screen.findByText("Reviewer workspace")).toBeInTheDocument();
  });
});
