import { EventEmitter } from "events";
import { SseWriter } from "../../src/utils/sse-writer";

function response() {
  const emitter = new EventEmitter();
  const writes: string[] = [];
  let writable = false;
  const res = Object.assign(emitter, {
    write: jest.fn((frame: string) => { writes.push(frame); return writable; }),
  });
  return { res, writes, allowWrites: () => { writable = true; emitter.emit("drain"); } };
}

describe("SseWriter", () => {
  it("coalesces contiguous cumulative deltas while a client is backpressured", () => {
    const { res, writes, allowWrites } = response();
    const writer = new SseWriter(res as any, { onOverflow: jest.fn() });

    writer.send("first");
    writer.send("delta: h", "message.delta");
    writer.send("delta: hello", "message.delta");
    allowWrites();

    expect(writes).toEqual(["first", "delta: hello"]);
  });

  it("closes and invokes the overflow handler instead of growing without bound", () => {
    const { res } = response();
    const overflow = jest.fn();
    const writer = new SseWriter(res as any, { maxQueuedBytes: 5, onOverflow: overflow });

    writer.send("blocked");
    expect(writer.send("too-large")).toBe(false);
    expect(overflow).toHaveBeenCalledTimes(1);
  });
});
