jest.mock("../../src/config/email", () => ({
  resend: { emails: { send: jest.fn() } },
}));

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    reviewerInvitation: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { resend } from "../../src/config/email";
import { prisma } from "../../src/db/prisma";
import { emailJob } from "../../src/jobs/workers/email.worker";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

function job(deliveryGeneration = 3) {
  return {
    data: {
      to: "ada@vc.test",
      subject: "Review Acme's data room",
      html: "<p>Invite</p>",
      reviewerInvitationId: "invite-1",
      deliveryGeneration,
    },
  } as never;
}

describe("emailJob reviewer invitation tracking", () => {
  it("skips a stale queued email after the invitation link was rotated", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({ deliveryGeneration: 4 } as never);

    const result = await emailJob.process(job(3));

    expect(resend.emails.send).not.toHaveBeenCalled();
    expect(result.messageId).toBe("skipped-stale-reviewer-invitation");
  });

  it("records the provider message id for the current generation", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({ deliveryGeneration: 3 } as never);
    (resend.emails.send as jest.Mock).mockResolvedValue({ data: { id: "resend-123" }, error: null });

    await emailJob.process(job(3));

    expect(mockPrisma.reviewerInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: "invite-1", deliveryGeneration: 3 },
      data: expect.objectContaining({
        deliveryStatus: "sent",
        deliveryMessageId: "resend-123",
      }),
    });
  });
});
