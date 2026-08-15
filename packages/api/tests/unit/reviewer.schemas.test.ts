import {
  createReviewerInvitationSchema,
  listReviewerInvitationsQuerySchema,
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

describe("reviewer portal schemas", () => {
  it("accepts access token", () => {
    expect(
      reviewerAccessSchema.safeParse({ token: "a".repeat(32) }).success,
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
});
