import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { Conversation, Message } from "../../lib/chat-api";

const listMessages = vi.fn();

vi.mock("../../lib/chat-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/chat-api")>()),
  listMessages: (...args: unknown[]) => listMessages(...args),
  markConversationRead: vi.fn(),
  setNotifyLevel: vi.fn(),
  toggleReaction: vi.fn(),
  deleteMessage: vi.fn(),
  setConversationArchived: vi.fn(),
}));
vi.mock("../../hooks/usePermissions", () => ({
  usePermissions: () => ({ can: () => false }),
}));
vi.mock("../../hooks/useWorkspace", () => ({
  useWorkspace: () => ({ activeStartup: { member: { id: "member-1" } } }),
}));
vi.mock("../../hooks/useResolvedMentions", () => ({ useResolvedMentions: () => new Map() }));
vi.mock("../../hooks/useTypingUsers", () => ({ useTypingUsers: () => [] }));
vi.mock("../../components/mentions/MessageItem", () => ({
  MessageItem: ({ message }: { message: Message }) => <p>{message.body}</p>,
}));
vi.mock("../../pages/dashboard/Chat/Composer", () => ({ Composer: () => null }));
vi.mock("../../pages/dashboard/Chat/ThreadDialog", () => ({ ThreadDialog: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { MessageThread } = await import("../../pages/dashboard/Chat/MessageThread");

function message(seq: number): Message {
  return {
    id: `message-${seq}`,
    startupId: "startup-1",
    conversationId: "conversation-1",
    seq: String(seq),
    senderId: "member-1",
    sender: null,
    body: `Message ${seq}`,
    parentMessageId: null,
    replyCount: 0,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(2026, 0, 1, 0, seq).toISOString(),
    reactions: [],
    attachments: [],
  };
}

const conversation: Conversation = {
  id: "conversation-1",
  startupId: "startup-1",
  type: "channel",
  name: "General",
  topic: null,
  counterpart: null,
  lastReadSeq: "100",
  notifyLevel: "all",
  unreadCount: 0,
  lastMessageAt: "2026-01-01T01:40:00.000Z",
  archivedAt: null,
  createdBy: "member-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T01:40:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listMessages
    .mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => message(index + 51)))
    .mockResolvedValueOnce([message(49), message(50)]);
});

it("loads older messages with the earliest sequence as its cursor", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MessageThread startupId="startup-1" conversation={conversation} canSend={false} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Message 100")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Load older messages" }));

  expect(await screen.findByText("Message 49")).toBeInTheDocument();
  await waitFor(() => expect(listMessages).toHaveBeenLastCalledWith(
    "startup-1",
    "conversation-1",
    { limit: 50, before: "51" },
  ));
});
