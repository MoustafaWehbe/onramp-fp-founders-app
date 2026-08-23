import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocumentPageAccess = vi.fn();

vi.mock("../../lib/document-api", () => ({
  getDocumentPageAccess: (...args: unknown[]) => getDocumentPageAccess(...args),
}));

const { DocumentPagePreviewDialog } = await import(
  "../../pages/dashboard/Documents/DocumentPagePreviewDialog"
);

function renderPreview(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DocumentPagePreviewDialog
        startupId="startup-1"
        context={{
          documentId: "document-1",
          versionId: "version-2",
          pageNumber: 8,
          sectionLabel: "Growth",
        }}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  getDocumentPageAccess.mockResolvedValue({
    url: "https://storage.example.test/page-8.webp",
    expiresInSeconds: 300,
    document: { id: "document-1", title: "Series A deck" },
    versionId: "version-2",
    versionNumber: 2,
    pageNumber: 8,
    width: 1600,
    height: 2200,
  });
});

describe("DocumentPagePreviewDialog", () => {
  it("shows exact context and provides keyboard-accessible zoom controls", async () => {
    const user = userEvent.setup();
    renderPreview();

    expect(await screen.findByRole("heading", { name: "Series A deck" })).toBeInTheDocument();
    expect(screen.getByText("Version 2, page 8, Growth")).toBeInTheDocument();
    const image = screen.getByRole("img", { name: "Series A deck, page 8" });
    expect(image).toHaveStyle({ width: "100%" });

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(image).toHaveStyle({ width: "125%" });
    expect(screen.getByText("125%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(image).toHaveStyle({ width: "100%" });
  });

  it("announces image-link failures and lets the founder retry", async () => {
    const user = userEvent.setup();
    renderPreview();

    const image = await screen.findByRole("img", { name: "Series A deck, page 8" });
    fireEvent.error(image);
    expect(screen.getByRole("alert")).toHaveTextContent("secure link may have expired");

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(getDocumentPageAccess).toHaveBeenCalledTimes(2);
  });
});
