const FUNDRAISING_CONTEXT = /\b(fundrais\w*|investor\w*|venture capital|\bvc\b|pipeline|term sheet|due diligence|pitch|deck|round|valuation|cap table|commitment|follow[- ]?up|meeting|outreach|startup|task|document|data room|financial|forecast|runway|traction|revenue|\barr\b|\bmrr\b)\b/i;

const CLEARLY_UNRELATED = /\b(hungry|what should i eat|food recommendation|recipe|breakfast|lunch|dinner|restaurant|weather|sports score|movie|music|video game|vacation itinerary|dating advice|relationship advice|homework|write code|debug code|medical advice|workout plan)\b/i;

export const AI_ROLE_SCOPE_RESPONSE = "I’m focused on helping with your fundraising work. I can help prioritize investors, review today’s tasks, prepare outreach, or assess your round.";

/** A conservative guard for unmistakably unrelated requests. Domain language wins. */
export function isClearlyOutsideFundraisingScope(prompt: string): boolean {
  return CLEARLY_UNRELATED.test(prompt) && !FUNDRAISING_CONTEXT.test(prompt);
}

/** The *entire* trimmed prompt, nothing more — a real question that happens to start with "thanks" still doesn't match. */
const BARE_ACKNOWLEDGEMENT = /^(thanks?|thank you|ok(ay)?|great|good|nice|cool|perfect|awesome|sounds (good|great)|makes sense|understood|got it|will do|noted|appreciated|much appreciated|yep|yeah|yes|no|nope|alright)[.!]{0,2}$/i;

/**
 * A bare social nicety carries no document question of its own, so it's not
 * worth the embedding call + pgvector scan retrieval costs on every turn —
 * the same reasoning as the scope gate above, applied to a cost decision
 * instead of a routing one. Deliberately exact-match-only and conservative:
 * this must never skip retrieval on a turn that might actually need it.
 */
export function isBareAcknowledgement(prompt: string): boolean {
  return BARE_ACKNOWLEDGEMENT.test(prompt.trim());
}
