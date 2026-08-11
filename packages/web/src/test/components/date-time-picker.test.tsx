import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimePicker } from "../../components/ui/date-time-picker";

function Harness({ initial = null }: { initial?: Date | null }) {
  const [value, setValue] = useState<Date | null>(initial);
  return (
    <>
      <DateTimePicker value={value} onChange={setValue} placeholder="Pick a date & time" />
      <span data-testid="value">{value ? value.toISOString() : "none"}</span>
    </>
  );
}

describe("DateTimePicker", () => {
  it("shows the placeholder with nothing selected", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /pick a date & time/i })).toBeInTheDocument();
  });

  it("picking a day defaults the time to 9:00 AM", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /pick a date & time/i }));
    const fifteenth = new Date();
    fifteenth.setDate(15);
    await user.click(screen.getByRole("button", { name: fifteenth.toDateString() }));

    const result = new Date(screen.getByTestId("value").textContent!);
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
  });

  it("picking a time keeps the previously selected day", async () => {
    const user = userEvent.setup();
    const initial = new Date(2026, 7, 20, 9, 0, 0, 0);
    render(<Harness initial={initial} />);

    await user.click(screen.getByRole("button", { name: /aug 20, 2026/i }));
    await user.click(screen.getByRole("button", { name: "2:30 PM" }));

    const result = new Date(screen.getByTestId("value").textContent!);
    expect(result.getDate()).toBe(20);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });

  it("clears the value", async () => {
    const user = userEvent.setup();
    const initial = new Date(2026, 7, 20, 9, 0, 0, 0);
    render(<Harness initial={initial} />);

    await user.click(screen.getByRole("button", { name: "Clear date" }));

    expect(screen.getByTestId("value")).toHaveTextContent("none");
    expect(screen.getByRole("button", { name: /pick a date & time/i })).toBeInTheDocument();
  });
});
