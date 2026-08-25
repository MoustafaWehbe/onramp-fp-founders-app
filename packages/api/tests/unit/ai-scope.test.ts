import { AI_ROLE_SCOPE_RESPONSE, isClearlyOutsideFundraisingScope, isBareAcknowledgement } from "../../src/services/ai-scope";

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

describe("isBareAcknowledgement", () => {
  it.each([
    "thanks", "Thanks!", "thank you", "ok", "Okay.", "great", "got it", "sounds good",
    "perfect", "cool", "  yep  ", "understood!", "will do", "noted.", "alright",
  ])("treats a plain social nicety as carrying no document question: %s", (prompt) => {
    expect(isBareAcknowledgement(prompt)).toBe(true);
  });

  it.each([
    "thanks, can you also check her check size?",
    "ok what about the deck she asked for?",
    "great, now pull up the term sheet",
    "What does the data room say about runway?",
    "",
  ])("never treats a real question as a bare acknowledgement, even one that starts the same way: %s", (prompt) => {
    expect(isBareAcknowledgement(prompt)).toBe(false);
  });
});
