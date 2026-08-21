import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const updateProfile = vi.fn();
const uploadAvatar = vi.fn();
const removeAvatar = vi.fn();
const PROFILE_USER = {
  id: "user-1",
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  title: null as string | null,
  avatarUrl: "https://images.example.com/ada.jpg",
};

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: PROFILE_USER,
    updateProfile,
    uploadAvatar,
    removeAvatar,
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
  it("saves edited names without touching the photo", async () => {
    const user = userEvent.setup();
    render(<Profile />);

    const firstName = screen.getByLabelText("First name");
    await user.clear(firstName);
    await user.type(firstName, "Augusta");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateProfile).toHaveBeenCalledWith({ firstName: "Augusta", lastName: "Lovelace" });
    expect(uploadAvatar).not.toHaveBeenCalled();
    expect(removeAvatar).not.toHaveBeenCalled();
  });

  it("removes the current profile photo on save", async () => {
    const user = userEvent.setup();
    render(<Profile />);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(removeAvatar).toHaveBeenCalledOnce();
    expect(uploadAvatar).not.toHaveBeenCalled();
    // Names were untouched, so there's nothing for updateProfile to do.
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("saves an edited title, used to sign off AI-drafted emails, without touching name", async () => {
    const user = userEvent.setup();
    render(<Profile />);

    const titleField = screen.getByLabelText("Title");
    await user.type(titleField, "Co-Founder & CEO");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateProfile).toHaveBeenCalledWith({ title: "Co-Founder & CEO" });
  });
});
