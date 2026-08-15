import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const updateProfile = vi.fn();
const PROFILE_USER = {
  id: "user-1",
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  avatarUrl: "https://images.example.com/ada.jpg",
};

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: PROFILE_USER,
    updateProfile,
  }),
}));

vi.mock("../../hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    activeStartup: { name: "Analytical Engines", member: { role: "owner" } },
  }),
}));

import { Profile } from "../../pages/dashboard/Profile";

beforeEach(() => vi.clearAllMocks());

describe("Profile", () => {
  it("saves edited names with the current profile photo", async () => {
    const user = userEvent.setup();
    render(<Profile />);

    const firstName = screen.getByLabelText("First name");
    await user.clear(firstName);
    await user.type(firstName, "Augusta");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateProfile).toHaveBeenCalledWith({
      firstName: "Augusta",
      lastName: "Lovelace",
      avatarUrl: "https://images.example.com/ada.jpg",
    });
  });

  it("can stage removal of the current profile photo", async () => {
    const user = userEvent.setup();
    render(<Profile />);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: null }));
  });
});
