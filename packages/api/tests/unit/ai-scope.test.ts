import { AI_ROLE_SCOPE_RESPONSE, isClearlyOutsideFundraisingScope } from "../../src/services/ai-scope";

describe("AI fundraising role scope", () => {
  it.each([
    "I'm hungry, what food should I eat?",
    "Recommend a movie for tonight",
    "Can you give me dating advice?",
    "Write code for a sorting algorithm",
  ])("rejects a clearly unrelated request: %s", (prompt) => {
    expect(isClearlyOutsideFundraisingScope(prompt)).toBe(true);
  });

  it.each([
    "Help me plan an investor dinner",
    "Debug my fundraising forecast",
    "What investor tasks are due today?",
  ])("allows a domain request with ambiguous language: %s", (prompt) => {
    expect(isClearlyOutsideFundraisingScope(prompt)).toBe(false);
  });

  it("redirects without answering the unrelated topic", () => {
    expect(AI_ROLE_SCOPE_RESPONSE).toContain("fundraising");
    expect(AI_ROLE_SCOPE_RESPONSE.toLowerCase()).not.toContain("food");
  });
});
