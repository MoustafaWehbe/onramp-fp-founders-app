import { describe, expect, it } from "vitest";
import { safeRedirect } from "../../lib/safe-redirect";

describe("safeRedirect", () => {
  it("keeps an in-app path with its query string", () => {
    expect(safeRedirect("/accept-invite?token=abc")).toBe("/accept-invite?token=abc");
  });

  it("falls back when there is no next parameter", () => {
    expect(safeRedirect(null)).toBe("/dashboard");
    expect(safeRedirect("")).toBe("/dashboard");
    expect(safeRedirect(undefined)).toBe("/dashboard");
  });

  it.each([
    ["https://evil.example/steal", "an absolute URL"],
    ["//evil.example/steal", "a protocol-relative URL"],
    ["/\\evil.example/steal", "a backslash browsers normalise to a slash"],
    ["javascript:alert(1)", "a script URL"],
    ["dashboard", "a relative path with no leading slash"],
  ])("refuses %s (%s)", (next) => {
    expect(safeRedirect(next)).toBe("/dashboard");
  });

  it("honours an explicit fallback", () => {
    expect(safeRedirect("//evil.example", "/auth/login")).toBe("/auth/login");
  });
});
