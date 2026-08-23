import {
  createReviewerInvitationSchema,
  listReviewerInvitationsQuerySchema,
  reviewerActivityQuerySchema,
} from "../../src/validators/reviewer.schemas";
import {
  reviewerAccessSchema,
  reviewerCommentSchema,
  reviewerVerifySchema,
} from "../../src/validators/reviewer-portal.schemas";

const UUID = "00000000-0000-0000-0000-000000000001";

describe("createReviewerInvitationSchema", () => {
  it("requires email and at least one document version", () => {
    expect(createReviewerInvitationSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
    expect(
      createReviewerInvitationSchema.safeParse({
        email: "a@b.com",
        documentVersionIds: [UUID],
      }).success,
    ).toBe(true);
  });

  it("uses the predefined NDA and strips attempted custom text", () => {
    const result = createReviewerInvitationSchema.safeParse({
      email: "a@b.com",
      documentVersionIds: [UUID],
      requireNda: true,
      ndaText: "Use my custom terms instead",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("ndaText");
  });

  it("validates domain format in allowedEmailDomains", () => {
    expect(
      createReviewerInvitationSchema.safeParse({
        email: "a@b.com",
        documentVersionIds: [UUID],
        allowedEmailDomains: ["not a domain"],
      }).success,
    ).toBe(false);
    expect(
      createReviewerInvitationSchema.safeParse({
        email: "a@b.com",
        documentVersionIds: [UUID],
        allowedEmailDomains: ["acme.com"],
      }).success,
    ).toBe(true);
  });

  it("rejects a password shorter than 6 characters", () => {
    expect(
      createReviewerInvitationSchema.safeParse({
        email: "a@b.com",
        documentVersionIds: [UUID],
        password: "abc",
      }).success,
    ).toBe(false);
    expect(
      createReviewerInvitationSchema.safeParse({
        email: "a@b.com",
        documentVersionIds: [UUID],
        password: "abcdef",
      }).success,
    ).toBe(true);
  });
});

describe("listReviewerInvitationsQuerySchema", () => {
  it("defaults page/limit", () => {
    const result = listReviewerInvitationsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });
});

describe("reviewerActivityQuerySchema", () => {
  it("defaults to 25 items and caps the timeline at 100", () => {
    expect(reviewerActivityQuerySchema.parse({}).limit).toBe(25);
    expect(reviewerActivityQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("accepts only bounded URL-safe cursors", () => {
    expect(reviewerActivityQuerySchema.safeParse({ cursor: "abc_DEF-123" }).success).toBe(true);
    expect(reviewerActivityQuerySchema.safeParse({ cursor: "not a cursor" }).success).toBe(false);
  });
});

describe("reviewer portal schemas", () => {
  it("accepts access token", () => {
    expect(
      reviewerAccessSchema.safeParse({ token: "a".repeat(32) }).success,
    ).toBe(true);
  });

  it("accepts an optional password on access", () => {
    expect(
      reviewerAccessSchema.safeParse({ token: "a".repeat(32), password: "hunter2" }).success,
    ).toBe(true);
  });

  it("requires 6-digit otp", () => {
    expect(
      reviewerVerifySchema.safeParse({ token: "a".repeat(32), otp: "12345" }).success,
    ).toBe(false);
    expect(
      reviewerVerifySchema.safeParse({ token: "a".repeat(32), otp: "123456" }).success,
    ).toBe(true);
  });

  it("requires comment text", () => {
    expect(reviewerCommentSchema.safeParse({ commentText: "" }).success).toBe(false);
    expect(reviewerCommentSchema.safeParse({ commentText: "Looks strong" }).success).toBe(true);
  });

  it("requires documentId when a comment pins an exact version", () => {
    expect(
      reviewerCommentSchema.safeParse({
        documentVersionId: UUID,
        commentText: "Version-specific feedback",
      }).success,
    ).toBe(false);
    expect(
      reviewerCommentSchema.safeParse({
        documentId: UUID,
        documentVersionId: UUID,
        commentText: "Version-specific feedback",
      }).success,
    ).toBe(true);
  });
});
