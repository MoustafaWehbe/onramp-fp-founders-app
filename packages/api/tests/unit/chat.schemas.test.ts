import {
  createConversationSchema,
  listConversationsQuerySchema,
} from "../../src/validators/chat.schemas";

const MEMBER_ID = "00000000-0000-0000-0000-000000000001";

describe("chat conversation schemas", () => {
  it("defaults selected members to an empty list", () => {
    const result = createConversationSchema.parse({ name: "fundraising" });
    expect(result.memberIds).toEqual([]);
  });

  it("accepts selected member ids and rejects malformed ids", () => {
    expect(createConversationSchema.safeParse({ name: "private", memberIds: [MEMBER_ID] }).success).toBe(true);
    expect(createConversationSchema.safeParse({ name: "private", memberIds: ["not-an-id"] }).success).toBe(false);
  });

  it("parses includeArchived without treating the string false as true", () => {
    expect(listConversationsQuerySchema.parse({ includeArchived: "true" }).includeArchived).toBe(true);
    expect(listConversationsQuerySchema.parse({ includeArchived: "false" }).includeArchived).toBe(false);
    expect(listConversationsQuerySchema.parse({}).includeArchived).toBe(false);
  });
});
