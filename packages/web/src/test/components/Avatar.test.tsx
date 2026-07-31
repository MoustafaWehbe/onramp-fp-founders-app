import { describe, expect, it } from "vitest";
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

  it("keeps the fallback when the image fails to load", () => {
    render(
      <Avatar>
        <AvatarImage src="/missing.png" alt="Ada" />
        <AvatarFallback>AD</AvatarFallback>
      </Avatar>,
    );

    fireEvent.error(screen.getByRole("img", { name: "Ada" }));

    expect(screen.getByText("AD")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
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
