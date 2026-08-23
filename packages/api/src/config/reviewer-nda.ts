export const REVIEWER_NDA_TEMPLATE_VERSION = "raise-reviewer-nda.v1";
export const REVIEWER_NDA_TEMPLATE_LABEL = "Raise standard confidentiality agreement";

/**
 * Canonical click-through confidentiality undertaking for the secure reviewer
 * portal. Invitations store the rendered text as a snapshot, so accepting an
 * older invitation always means accepting the exact version originally sent.
 */
export function renderReviewerNda(companyName: string): string {
  const company = companyName.trim() || "the disclosing company";
  return `CONFIDENTIALITY UNDERTAKING
Template version: ${REVIEWER_NDA_TEMPLATE_VERSION}

By selecting “I agree,” the reviewer (“Recipient”) agrees with ${company} (“Company”) to use the information made available through this data room only to evaluate a potential investment or advisory relationship with the Company (the “Purpose”).

1. Confidential information. “Confidential Information” means non-public business, product, technical, customer, financial, legal, and fundraising information disclosed through this data room or in connection with the Purpose.

2. Recipient obligations. Recipient will keep Confidential Information confidential, use it only for the Purpose, and disclose it only to professional advisers or colleagues who need it for the Purpose and are bound by confidentiality obligations at least as protective as these terms. Recipient is responsible for their compliance.

3. Exclusions. Confidential Information does not include information Recipient can document was already lawfully known without restriction, becomes public without breach of these terms, is received lawfully from another source without restriction, or is independently developed without using Confidential Information.

4. Required disclosure. If disclosure is required by law, Recipient will, where legally permitted, give the Company prompt notice and disclose only what is legally required.

5. Ownership and no commitment. The Company retains all rights in its Confidential Information. No license is granted, and neither party is required to proceed with any transaction or relationship.

6. Return or deletion. On request, Recipient will stop using and delete or return Confidential Information, except for archival copies required by law or automatic backup systems that remain protected by these terms.

7. Duration. These obligations continue for two years after acceptance. Trade secrets remain protected for as long as they qualify as trade secrets under applicable law.

8. Electronic acceptance. Recipient agrees that electronic acceptance is binding and that the acceptance time and verified email may be recorded as evidence of agreement.`;
}
