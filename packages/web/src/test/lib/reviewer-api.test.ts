import { describe, expect, it } from "vitest";
import { reviewerDocumentContextHref } from "../../lib/reviewer-api";

describe("reviewerDocumentContextHref", () => {
  it("pins a founder deep-link to the reviewed version and page", () => {
    expect(
      reviewerDocumentContextHref({
        documentId: "document-1",
        versionId: "version-2",
        pageNumber: 8,
        sectionLabel: "Growth & retention",
      }),
    ).toBe(
      "/documents?document=document-1&version=version-2&page=8&preview=1&section=Growth+%26+retention",
    );
  });

  it("still links general feedback to its exact document version", () => {
    expect(
      reviewerDocumentContextHref({ documentId: "document-1", versionId: "version-2" }),
    ).toBe("/documents?document=document-1&version=version-2");
  });
});
