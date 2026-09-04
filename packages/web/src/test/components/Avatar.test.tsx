import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";

describe("Avatar", () => {
  it("shows the fallback and hides it once the image loads", () => {
    render(
      <Avatar>
        <AvatarImage src="/avatar.png" alt="Ada" />
        <AvatarFallback>AD</AvatarFallback>
      </Avatar>,
    );

    // Before load both would previously render side by side.
    expect(screen.getByText("AD")).toBeInTheDocument();

    fireEvent.load(screen.getByRole("img", { name: "Ada" }));

    expect(screen.queryByText("AD")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ada" })).toBeVisible();
  });

  it("retries once on a transient load failure instead of giving up immediately", () => {
    render(
      <Avatar>
        <AvatarImage src="/flaky.png" alt="Ada" />
        <AvatarFallback>AD</AvatarFallback>
      </Avatar>,
    );

    fireEvent.error(screen.getByRole("img", { name: "Ada" }));

    // A single error a real-world blip loading a third-party avatar URL
    // gets a fresh <img> retry, not an immediate, permanent fallback.
    expect(screen.getByRole("img", { name: "Ada" })).toBeInTheDocument();
    expect(screen.getByText("AD")).toBeInTheDocument();

    fireEvent.load(screen.getByRole("img", { name: "Ada" }));

    expect(screen.queryByText("AD")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ada" })).toBeVisible();
  });

  it("keeps the fallback once the retry also fails to load", () => {
    render(
      <Avatar>
        <AvatarImage src="/missing.png" alt="Ada" />
        <AvatarFallback>AD</AvatarFallback>
      </Avatar>,
    );

    fireEvent.error(screen.getByRole("img", { name: "Ada" }));
    fireEvent.error(screen.getByRole("img", { name: "Ada" }));

    expect(screen.getByText("AD")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows a cached image whose load event fired before React attached onLoad", () => {
    // The sidebar bug: a cached avatar completes before the handler is
    // attached, so `load` never fires. Trusting the event alone left the image
    // invisible behind its initials for the rest of the page, while a plain
    // <img> of the very same URL rendered fine beside it.
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockReturnValue(96);

    try {
      render(
        <Avatar>
          <AvatarImage src="/cached.png" alt="Ada" />
          <AvatarFallback>AD</AvatarFallback>
        </Avatar>,
      );

      // No fireEvent.load — the point is that the event never arrives.
      expect(screen.queryByText("AD")).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Ada" })).toBeVisible();
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });

  it("renders only the fallback when no src is given", () => {
    render(
      <Avatar>
        <AvatarFallback>AD</AvatarFallback>
      </Avatar>,
    );

    expect(screen.getByText("AD")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
