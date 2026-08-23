import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../lib/chat-api";

const listConversations = vi.fn();

vi.mock("../../lib/chat-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/chat-api")>()),
  listConversations: (...args: unknown[]) => listConversations(...args),
  createConversation: vi.fn(),
  startDirectMessage: vi.fn(),
}));
vi.mock("../../hooks/useWorkspace", () => ({ useActiveStartupId: () => "startup-1" }));
vi.mock("../../hooks/usePermissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../../pages/dashboard/Chat/NewChannelDialog", () => ({
  NewChannelDialog: () => null,
}));
vi.mock("../../pages/dashboard/Chat/NewDirectMessageDialog", () => ({
  NewDirectMessageDialog: () => null,
}));
vi.mock("../../pages/dashboard/Chat/MessageThread", () => ({
  MessageThread: ({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) => {
    const [draft, setDraft] = useState("");
    return (
      <div>
        <p>Room: {conversation.name}</p>
        <label>
          Draft
          <input value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <button type="button" onClick={onBack}>Back to channels</button>
      </div>
    );
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { Chat } = await import("../../pages/dashboard/Chat/Chat");

function conversation(id: string, name: string): Conversation {
  return {
    id,
    startupId: "startup-1",
    type: "channel",
    name,
    topic: null,
    counterpart: null,
    lastReadSeq: null,
    notifyLevel: "all",
    unreadCount: 0,
    lastMessageAt: null,
    archivedAt: null,
    createdBy: "member-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function LocationProbe() {
  return <output aria-label="location">{useLocation().search}</output>;
}

function renderChat(initialEntry = "/chat?c=alpha") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Chat />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listConversations.mockResolvedValue([
    conversation("alpha", "Alpha"),
    conversation("beta", "Beta"),
  ]);
});

describe("Chat", () => {
  it("isolates drafts between rooms and keeps the selected room in the URL", async () => {
    const user = userEvent.setup();
    renderChat();

    expect(await screen.findByText("Room: Alpha")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Draft"), "private Alpha draft");
    await user.click(screen.getByRole("button", { name: /Beta/ }));

    expect(await screen.findByText("Room: Beta")).toBeInTheDocument();
    expect(screen.getByLabelText("Draft")).toHaveValue("");
    expect(screen.getByLabelText("location")).toHaveTextContent("?c=beta");
  });

  it("lets mobile navigation return to the list without reopening the default room", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("Room: Alpha");

    await user.click(screen.getByRole("button", { name: "Back to channels" }));

    expect(screen.queryByLabelText("Draft")).not.toBeInTheDocument();
    expect(screen.getByLabelText("location")).toHaveTextContent("");
  });

  it("shows a recoverable load error instead of an empty-workspace message", async () => {
    listConversations
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce([conversation("alpha", "Alpha")]);
    const user = userEvent.setup();
    renderChat("/chat");

    expect(await screen.findByText("Failed to load conversations.")).toBeInTheDocument();
    expect(screen.queryByText("No channels yet")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Room: Alpha")).toBeInTheDocument();
  });
});
