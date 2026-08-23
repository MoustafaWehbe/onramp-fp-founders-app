import { describe, expect, it } from "vitest";
import type { DocumentVersion } from "../../lib/document-api";
import { statusOf } from "../../pages/dashboard/Documents/document-types";

function version(
  processingStatus: DocumentVersion["processingStatus"],
  renderStatus: DocumentVersion["renderStatus"],
) {
  return { processingStatus, renderStatus } as DocumentVersion;
}

describe("document status", () => {
  it("does not report ready while rendering is still running", () => {
    expect(statusOf(version("ready", "rendering"))).toBe("processing");
  });

  it("surfaces a render failure even when extraction succeeded", () => {
    expect(statusOf(version("ready", "failed"))).toBe("failed");
  });

  it("treats unsupported rendering as a ready vault document", () => {
    expect(statusOf(version("ready", "unsupported"))).toBe("ready");
  });
});
