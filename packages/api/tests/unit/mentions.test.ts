import { parseMentions, toPlainExcerpt } from "../../src/utils/mentions";

const UUID = "3f9c1a2b-4d5e-6f70-8192-a3b4c5d6e7f8";
const UUID_2 = "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809";

describe("parseMentions", () => {
  it("extracts a single reference token", () => {
    expect(parseMentions(`ping @[Sequoia — Seed](deal:${UUID}) about the deck`)).toEqual([
      { type: "deal", id: UUID, label: "Sequoia — Seed" },
    ]);
  });

  it("extracts multiple distinct tokens in order", () => {
    const body = `@[Maya](member:${UUID}) can you follow up with @[Sequoia](investor:${UUID_2})?`;
    expect(parseMentions(body)).toEqual([
      { type: "member", id: UUID, label: "Maya" },
      { type: "investor", id: UUID_2, label: "Sequoia" },
    ]);
  });

  it("deduplicates the same (type, id) referenced twice", () => {
    const body = `@[Sequoia — Seed](deal:${UUID}) — following up on @[Sequoia — Seed](deal:${UUID}) again`;
    expect(parseMentions(body)).toHaveLength(1);
  });

  it("ignores an unrecognized target type", () => {
    expect(parseMentions(`@[Something](bogus:${UUID})`)).toEqual([]);
  });

  it("ignores a malformed UUID", () => {
    expect(parseMentions(`@[Something](deal:not-a-uuid)`)).toEqual([]);
  });

  it("ignores plain-text @ mentions and email addresses", () => {
    expect(parseMentions("email me at founder@example.com or just say @here")).toEqual([]);
  });

  it("returns nothing for a body with no tokens", () => {
    expect(parseMentions("just a normal message")).toEqual([]);
  });
});

describe("toPlainExcerpt", () => {
  it("renders a token down to its display label", () => {
    expect(toPlainExcerpt(`ping @[Sequoia — Seed](deal:${UUID}) about the deck`)).toBe(
      "ping @Sequoia — Seed about the deck",
    );
  });

  it("truncates long bodies with an ellipsis", () => {
    const body = "a".repeat(200);
    const result = toPlainExcerpt(body, 140);
    expect(result).toHaveLength(140);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves a short plain body untouched", () => {
    expect(toPlainExcerpt("short message")).toBe("short message");
  });
});
