import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The permission set the signed-in member's role grants, swapped per test.
let grants: string[] = [];
vi.mock("../../hooks/useWorkspace", () => ({
  useActiveStartupId: () => "startup-1",
  useWorkspace: () => ({
    activeStartup: {
      id: "startup-1",
      name: "Acme",
      fundingStage: "seed",
      industry: "fintech",
      member: { role: "custom", permissions: grants },
    },
    startups: [],
    setActiveStartupId: vi.fn(),
  }),
}));
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.com", firstName: "A", lastName: "B" }, logout: vi.fn() }),
}));

const { RequirePermission } = await import("../../routes/RequirePermission");
const { Sidebar } = await import("../../components/layout/Sidebar");

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequirePermission />}>
          <Route path={path} element={<div>page body</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  grants = [];
});

describe("RequirePermission", () => {
  it("renders the page when the role holds the grant", () => {
    grants = ["pipeline:read"];
    renderAt("/pipeline");

    expect(screen.getByText("page body")).toBeInTheDocument();
  });

  it("explains the gap instead of rendering a shell that 403s", () => {
    grants = ["startup:read"];
    renderAt("/pipeline");

    expect(screen.queryByText("page body")).not.toBeInTheDocument();
    expect(screen.getByText("You don't have access to this")).toBeInTheDocument();
  });

  it("names the exact permission, worded the way the role editor labels it", () => {
    grants = ["pipeline:read"];
    renderAt("/fundraising");

    expect(screen.getByText("Rounds & commitments: View")).toBeInTheDocument();
  });

  it("keeps the pipeline board reachable without the financial grant", () => {
    // Revoking "Rounds & commitments" used to take the whole board with it:
    // the board is round-scoped and the round list was financial-only.
    grants = ["pipeline:read", "startup:read"];
    renderAt("/pipeline");

    expect(screen.getByText("page body")).toBeInTheDocument();
  });

  it("points someone who can manage roles at the page that fixes it", () => {
    grants = ["team:read", "team:manage"];
    renderAt("/documents");

    expect(screen.getByRole("link", { name: "Open Team & Roles" })).toBeInTheDocument();
  });

  it("tells everyone else who to ask rather than linking them somewhere else they can't open", () => {
    grants = ["startup:read"];
    renderAt("/documents");

    expect(screen.queryByRole("link", { name: "Open Team & Roles" })).not.toBeInTheDocument();
    expect(screen.getByText(/workspace owner or admin can enable it/i)).toBeInTheDocument();
  });

  it("leaves paths it knows nothing about alone", () => {
    grants = [];
    renderAt("/settings");

    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});

describe("Sidebar", () => {
  function renderSidebar() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <QueryClientProvider client={client}>
          <Sidebar />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("hides exactly the destinations the route guard would block", () => {
    grants = ["pipeline:read", "ai_reports:read"];
    renderSidebar();

    expect(screen.getByRole("link", { name: /pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /investors/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^rounds$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /documents/i })).not.toBeInTheDocument();
  });

  it("drops a group heading whose every item is out of reach", () => {
    grants = ["pipeline:read"];
    renderSidebar();

    expect(screen.queryByText("Data Room")).not.toBeInTheDocument();
    expect(screen.getByText("Fundraising")).toBeInTheDocument();
  });

  it("always keeps the pages that need no grant at all", () => {
    grants = [];
    renderSidebar();

    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
  });
});
