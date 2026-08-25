import { EventEmitter } from "events";
import type { AiStreamEnvelope } from "../../src/services/ai-stream-broker.service";

let liveListener: ((event: AiStreamEnvelope) => void) | undefined;
const openStream = jest.fn();
const replayStream = jest.fn();
const readyForRemoteStreamEvents = jest.fn();
const isGenerationActive = jest.fn();
const unsubscribe = jest.fn();

jest.mock("../../src/services/ai-conversation.service", () => ({
  aiConversationService: {
    openStream,
    replayStream,
    readyForRemoteStreamEvents,
    isGenerationActive,
    subscribe: jest.fn((_messageId: string, listener: (event: AiStreamEnvelope) => void) => { liveListener = listener; return unsubscribe; }),
  },
}));
jest.mock("../../src/services/ai-chat.service", () => ({ aiChatService: {} }));
jest.mock("../../src/services/ai-analysis.service", () => ({ aiAnalysisService: {} }));

import { aiController } from "../../src/controllers/ai.controller";

function envelope(sequence: number, type: AiStreamEnvelope["type"], payload: Record<string, unknown> = {}): AiStreamEnvelope {
  return { version: 1, sessionId: "session-1", messageId: "message-1", sequence, timestamp: new Date().toISOString(), type, payload };
}

function requestAndResponse() {
  const req = Object.assign(new EventEmitter(), {
    params: { startupId: "startup-1", sessionId: "session-1", messageId: "message-1" },
    user: { userId: "user-1" },
    // requireMember resolves the role's grants before the handler runs.
    member: { roleId: "role-1", permissions: new Set(["ai_reports:read"]) },
    header: jest.fn().mockReturnValue(undefined),
  });
  const written: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    flushHeaders: jest.fn(),
    write: jest.fn((chunk: string) => { written.push(chunk); return true; }),
    end: jest.fn(),
  });
  return { req, res, written, next: jest.fn() };
}

describe("AI SSE controller handoff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    liveListener = undefined;
    openStream.mockResolvedValue({ message: { status: "completed", content: "Done", errorMessage: null } });
    replayStream.mockResolvedValue([envelope(1, "message.completed", { content: "Done" })]);
    readyForRemoteStreamEvents.mockResolvedValue(undefined);
    isGenerationActive.mockResolvedValue(true);
  });

  it("keeps a completed message connected while artifacts are still being generated", async () => {
    const { req, res, written, next } = requestAndResponse();

    aiController.streamMessage(req as any, res as any, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.end).not.toHaveBeenCalled();
    liveListener?.(envelope(2, "artifact.ready", { artifact: { id: "artifact-1" } }));
    liveListener?.(envelope(3, "stream.closed"));

    expect(written.join("")).toContain("event: artifact.ready");
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("buffers events during replay and sends an overlapping sequence only once", async () => {
    const overlapping = envelope(2, "message.delta", { content: "Hello" });
    readyForRemoteStreamEvents.mockImplementation(async () => { liveListener?.(overlapping); });
    replayStream.mockResolvedValue([envelope(1, "message.started"), overlapping]);
    openStream.mockResolvedValue({ message: { status: "streaming", content: "", errorMessage: null } });
    isGenerationActive.mockResolvedValue(true);
    const { req, res, written, next } = requestAndResponse();

    aiController.streamMessage(req as any, res as any, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(written.join("").match(/event: message\.delta/g)).toHaveLength(1);
    req.emit("close");
    expect(unsubscribe).toHaveBeenCalled();
  });
});
