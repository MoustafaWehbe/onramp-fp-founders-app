import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Message } from "../../lib/chat-api";

const resolveMentions = vi.fn();
vi.mock("../../lib/chat-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/chat-api")>()),
  resolveMentions: (...args: unknown[]) => resolveMentions(...args),
}));

const { useResolvedMentions } = await import("../../hooks/useResolvedMentions");

function message(index: number): Message {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    id: `message-${index}`,
    startupId: "startup-1",
    conversationId: "conversation-1",
    seq: String(index),
    senderId: null,
    sender: null,
    body: `@[Deal ${index}](deal:${id})`,
    parentMessageId: null,
    replyCount: 0,
    editedAt: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    reactions: [],
    attachments: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveMentions.mockResolvedValue([]);
});

it("batches mention resolution after older history pushes the set over the API limit", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  renderHook(() => useResolvedMentions("startup-1", Array.from({ length: 51 }, (_, index) => message(index + 1))), {
    wrapper,
  });

  await waitFor(() => expect(resolveMentions).toHaveBeenCalledTimes(2));
  expect(resolveMentions.mock.calls[0][1]).toHaveLength(50);
  expect(resolveMentions.mock.calls[1][1]).toHaveLength(1);
});
