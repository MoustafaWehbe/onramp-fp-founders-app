import { AiStreamBroker } from "../../src/services/ai-stream-broker.service";

describe("AI stream broker", () => {
  it("assigns monotonic sequences and replays only newer events", () => {
    const broker = new AiStreamBroker();
    broker.publish("session-1", "message-1", "message.started", {});
    broker.publish("session-1", "message-1", "message.delta", { text: "Hello" });
    expect(broker.replay("message-1", 1)).toMatchObject([{ sequence: 2, type: "message.delta" }]);
  });
});
