import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Message } from "../../lib/chat-api";

const listMessages = vi.fn();
const sendMessage = vi.fn();

vi.mock("../../lib/chat-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/chat-api")>()),
  listMessages: (...args: unknown[]) => listMessages(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  markConversationRead: vi.fn(),
  pingTyping: vi.fn().mockResolvedValue(undefined),
  searchMentionables: vi.fn().mockResolvedValue([]),
  setNotifyLevel: vi.fn(),
  toggleReaction: vi.fn(),
  deleteMessage: vi.fn(),
  setConversationArchived: vi.fn(),
  resolveMentions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../hooks/usePermissions", () => ({
  usePermissions: () => ({ can: () => false }),
}));
vi.mock("../../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ activeStartup: { member: { id: "member-1" } } }),
}));
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      firstName: "Ada",
      lastName: "Founder",
      avatarUrl: null,
    },
  }),
}));
vi.mock("../../hooks/useTypingUsers", () => ({ useTypingUsers: () => [] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { Composer } = await import("../../pages/dashboard/Chat/Composer");
const { MessageThread } = await import("../../pages/dashboard/Chat/MessageThread");

const conversation: Conversation = {
  id: "conversation-1",
  startupId: "startup-1",
  type: "channel",
  name: "General",
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

function delivered(input: { body: string; clientNonce: string }): Message {
  return {
    id: "server-message-1",
    startupId: "startup-1",
    conversationId: "conversation-1",
    seq: "1",
    senderId: "member-1",
    sender: { id: "member-1", firstName: "Ada", lastName: "Founder", avatarUrl: null },
    body: input.body,
    parentMessageId: null,
    replyCount: 0,
    editedAt: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    reactions: [],
    attachments: [],
  };
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  listMessages.mockResolvedValue([]);
});

describe("Chat outbox", () => {
  it("keeps drafts separate per conversation and restores them after remount", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const first = render(
      <Composer startupId="startup-1" conversationId="conversation-1" conversationName="General" />,
      { wrapper: wrapper(client) },
    );
    await user.type(screen.getByRole("textbox"), "Draft for General");
    first.unmount();

    const second = render(
      <Composer startupId="startup-1" conversationId="conversation-2" conversationName="Finance" />,
      { wrapper: wrapper(client) },
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
    second.unmount();

    render(
      <Composer startupId="startup-1" conversationId="conversation-1" conversationName="General" />,
      { wrapper: wrapper(client) },
    );
    expect(screen.getByRole("textbox")).toHaveValue("Draft for General");
  });

  it("shows a failed optimistic message and retries with the original idempotency nonce", async () => {
    let rejectFirstSend!: (reason?: unknown) => void;
    sendMessage
      .mockImplementationOnce(
        () =>
          new Promise<Message>((_resolve, reject) => {
            rejectFirstSend = reject;
          }),
      )
      .mockImplementationOnce((_startupId, _conversationId, input) => Promise.resolve(delivered(input)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <MessageThread startupId="startup-1" conversation={conversation} canSend />,
      { wrapper: wrapper(client) },
    );
    await screen.findByText("No messages yet");

    await user.type(screen.getByRole("textbox"), "Investor replied");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Sending")).toBeInTheDocument();
    await act(async () => rejectFirstSend(new Error("offline")));
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    const originalNonce = sendMessage.mock.calls[0][2].clientNonce;
    await user.click(screen.getByRole("button", { name: "Retry sending" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(sendMessage.mock.calls[1][2].clientNonce).toBe(originalNonce);
    await act(async () => Promise.resolve());
  });
});
