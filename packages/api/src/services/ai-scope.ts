const FUNDRAISING_CONTEXT = /\b(fundrais\w*|investor\w*|venture capital|\bvc\b|pipeline|term sheet|due diligence|pitch|deck|round|valuation|cap table|commitment|follow[- ]?up|meeting|outreach|startup|task|document|data room|financial|forecast|runway|traction|revenue|\barr\b|\bmrr\b)\b/i;

const CLEARLY_UNRELATED = /\b(hungry|what should i eat|food recommendation|recipe|breakfast|lunch|dinner|restaurant|weather|sports score|movie|music|video game|vacation itinerary|dating advice|relationship advice|homework|write code|debug code|medical advice|workout plan)\b/i;

export const AI_ROLE_SCOPE_RESPONSE = "I’m focused on helping with your fundraising work. I can help prioritize investors, review today’s tasks, prepare outreach, or assess your round.";

/** A conservative guard for unmistakably unrelated requests. Domain language wins. */
export function isClearlyOutsideFundraisingScope(prompt: string): boolean {
  return CLEARLY_UNRELATED.test(prompt) && !FUNDRAISING_CONTEXT.test(prompt);
}
