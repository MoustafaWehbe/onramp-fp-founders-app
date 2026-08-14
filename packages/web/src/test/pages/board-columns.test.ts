import { describe, expect, it } from "vitest";
import {
  buildColumns,
  columnDropId,
  columnOf,
  computeDropOrder,
  moveWithinColumns,
} from "../../pages/dashboard/Pipeline/board-columns";
import type { PipelineEntry } from "../../lib/pipeline-api";

function entry(id: string, stage: PipelineEntry["stage"], sortOrder: number): PipelineEntry {
  return {
    id,
    startupId: "startup-1",
    roundId: "round-1",
    investorId: `inv-${id}`,
    investor: {
      id: `inv-${id}`,
      startupId: "startup-1",
      fullName: id,
      email: null,
      ventureFirm: null,
      investorType: null,
      sectorFocus: null,
      investmentStagePreference: null,
      linkedinUrl: null,
      notes: null,
      source: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    stage,
    expectedAmount: null,
    probabilityPercentage: null,
    ownerId: null,
    priority: null,
    investorFitScore: null,
  isLead: false,
    sortOrder,
    stageChangedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildColumns / columnOf", () => {
  it("groups deals by stage, preserving input order", () => {
    const columns = buildColumns([
      entry("a", "sourced", 1000),
      entry("b", "contacted", 1000),
      entry("c", "sourced", 2000),
    ]);

    expect(columns.sourced).toEqual(["a", "c"]);
    expect(columns.contacted).toEqual(["b"]);
    expect(columns.term_sheet).toEqual([]);
  });

  it("finds which column a deal is in", () => {
    const columns = buildColumns([entry("a", "sourced", 1000)]);
    expect(columnOf(columns, "a")).toBe("sourced");
    expect(columnOf(columns, "missing")).toBeUndefined();
  });
});

describe("moveWithinColumns", () => {
  it("reorders within the same column", () => {
    const columns = buildColumns([
      entry("a", "sourced", 1000),
      entry("b", "sourced", 2000),
      entry("c", "sourced", 3000),
    ]);

    const next = moveWithinColumns(columns, "a", "c");

    expect(next.sourced).toEqual(["b", "c", "a"]);
  });

  it("moves a card into a different column at the hovered position", () => {
    const columns = buildColumns([
      entry("a", "sourced", 1000),
      entry("b", "contacted", 1000),
      entry("c", "contacted", 2000),
    ]);

    const next = moveWithinColumns(columns, "a", "c");

    expect(next.sourced).toEqual([]);
    expect(next.contacted).toEqual(["b", "a", "c"]);
  });

  it("drops into an empty column via its droppable id", () => {
    const columns = buildColumns([entry("a", "sourced", 1000)]);

    const next = moveWithinColumns(columns, "a", columnDropId("committed"));

    expect(next.sourced).toEqual([]);
    expect(next.committed).toEqual(["a"]);
  });

  it("appends to the end when the hovered column has no matching card", () => {
    const columns = buildColumns([entry("a", "sourced", 1000), entry("b", "contacted", 1000)]);

    const next = moveWithinColumns(columns, "a", columnDropId("contacted"));

    expect(next.contacted).toEqual(["b", "a"]);
  });

  it("is a no-op when dragged onto itself", () => {
    const columns = buildColumns([entry("a", "sourced", 1000)]);
    expect(moveWithinColumns(columns, "a", "a")).toBe(columns);
  });

  it("returns the same reference when the position doesn't actually change", () => {
    const columns = buildColumns([entry("a", "sourced", 1000), entry("b", "sourced", 2000)]);
    expect(moveWithinColumns(columns, "a", "a")).toBe(columns);
  });
});

describe("computeDropOrder", () => {
  const sortOrderOf = (id: string) =>
    ({ a: 1000, b: 2000, c: 3000 })[id as "a" | "b" | "c"];

  it("averages the two neighbors it landed between", () => {
    const arranged = { sourced: ["a", "x", "b"] } as ReturnType<typeof buildColumns>;
    expect(computeDropOrder(arranged, "x", sortOrderOf)).toBe(1500);
  });

  it("extends past the last card when dropped at the end", () => {
    const arranged = { sourced: ["a", "b", "x"] } as ReturnType<typeof buildColumns>;
    expect(computeDropOrder(arranged, "x", sortOrderOf)).toBe(3000);
  });

  it("extends before the first card when dropped at the start", () => {
    const arranged = { sourced: ["x", "a", "b"] } as ReturnType<typeof buildColumns>;
    expect(computeDropOrder(arranged, "x", sortOrderOf)).toBe(0);
  });

  it("returns the default gap for the only card in an empty column", () => {
    const arranged = { sourced: ["x"] } as ReturnType<typeof buildColumns>;
    expect(computeDropOrder(arranged, "x", sortOrderOf)).toBe(1000);
  });
});
