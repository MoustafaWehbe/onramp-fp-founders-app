import { useCallback, useEffect, useRef } from "react";
import type { AiStreamEvent } from "../lib/ai-api";

type StreamOptions = {
  url: string;
  onEvent: (event: AiStreamEvent) => void;
  onError: () => void;
};

/**
 * Fetch-based SSE keeps the authenticated cookie flow intact and lets us send
 * Last-Event-ID on reconnect. EventSource cannot set that header itself.
 */
export function useAiStream() {
  const controllerRef = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const open = useCallback(async ({ url, onEvent, onError }: StreamOptions) => {
    close();
    const controller = new AbortController();
    controllerRef.current = controller;
    let lastEventId = 0;

    for (let attempt = 0; attempt < 3 && !controller.signal.aborted; attempt += 1) {
      try {
        const response = await fetch(url, {
          credentials: "include",
          signal: controller.signal,
          headers: lastEventId ? { "Last-Event-ID": String(lastEventId) } : undefined,
        });
        if (!response.ok || !response.body) throw new Error("AI stream could not be opened");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let terminal = false;
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (!data) continue;
            const event = JSON.parse(data) as AiStreamEvent;
            // SSE + Last-Event-ID replay is at-least-once delivery: a reconnect can
            // legitimately resend events the client already applied (e.g. if the
            // Last-Event-ID header never made it to the server, or a proxy buffers
            // and redelivers). Sequence numbers are strictly increasing per message,
            // so anything at or below the high-water mark is a duplicate and is
            // dropped here rather than double-applying citations/artifacts.
            if (event.sequence > 0) {
              if (event.sequence <= lastEventId) continue;
              lastEventId = event.sequence;
            }
            onEvent(event);
            if (["message.completed", "message.failed", "message.cancelled"].includes(event.type)) terminal = true;
          }
        }
        if (terminal || controller.signal.aborted) return;
      } catch {
        if (controller.signal.aborted) return;
      }
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
    }
    if (!controller.signal.aborted) onError();
  }, [close]);

  useEffect(() => close, [close]);
  return { open, close };
}
