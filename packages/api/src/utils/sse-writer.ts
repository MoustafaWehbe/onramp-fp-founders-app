import type { Response } from "express";

type QueueEntry = { frame: string; coalesceKey?: string };

/**
 * Writes SSE frames without allowing a slow/disconnected client to create an
 * unbounded application-level queue. A coalesce key is useful for cumulative
 * snapshots such as AI message.delta events: while blocked, only the newest
 * contiguous snapshot needs to survive.
 */
export class SseWriter {
  private readonly queue: QueueEntry[] = [];
  private queuedBytes = 0;
  private blocked = false;
  private closed = false;

  constructor(
    private readonly response: Pick<Response, "write" | "once" | "off">,
    private readonly options: { maxQueuedBytes?: number; onOverflow: () => void },
  ) {}

  send(frame: string, coalesceKey?: string): boolean {
    if (this.closed) return false;
    if (!this.blocked && this.queue.length === 0) {
      if (!this.response.write(frame)) {
        this.blocked = true;
        this.response.once("drain", this.flush);
      }
      return true;
    }

    const previous = this.queue.at(-1);
    if (coalesceKey && previous?.coalesceKey === coalesceKey) {
      this.queuedBytes -= Buffer.byteLength(previous.frame);
      previous.frame = frame;
    } else {
      this.queue.push({ frame, coalesceKey });
    }
    this.queuedBytes += Buffer.byteLength(frame);

    if (this.queuedBytes > (this.options.maxQueuedBytes ?? 512 * 1024)) {
      this.close();
      this.options.onOverflow();
      return false;
    }
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.response.off("drain", this.flush);
    this.queue.length = 0;
    this.queuedBytes = 0;
  }

  private readonly flush = (): void => {
    if (this.closed) return;
    this.blocked = false;
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.queuedBytes -= Buffer.byteLength(next.frame);
      if (!this.response.write(next.frame)) {
        this.blocked = true;
        this.response.once("drain", this.flush);
        return;
      }
    }
  };
}
