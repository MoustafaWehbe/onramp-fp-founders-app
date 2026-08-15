import { GmailSendService } from "../../src/services/gmail-send.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupInvestor: { findUnique: jest.fn() },
    pipeline: { findUnique: jest.fn(), findFirst: jest.fn() },
    googleConnection: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    interactionLog: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

jest.mock("../../src/services/google-connection.service", () => ({
  googleConnectionService: { getValidAccessToken: jest.fn() },
}));

const mockQueueAdd = jest.fn();
jest.mock("../../src/jobs/queue", () => ({
  gmailLogRetryQueue: { add: (...args: unknown[]) => mockQueueAdd(...args) },
}));

import { prisma } from "../../src/db/prisma";
import { googleConnectionService } from "../../src/services/google-connection.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetValidAccessToken = googleConnectionService.getValidAccessToken as jest.Mock;
const service = new GmailSendService();

const STARTUP_ID = "startup-1";
const INVESTOR_ID = "investor-1";
const USER_ID = "user-1";
const PIPELINE_ID = "pipeline-1";

const INVESTOR = { id: INVESTOR_ID, email: "investor@example.com" };
const CONNECTION = { status: "active", googleEmail: "founder@gmail.com" };
const USER = { firstName: "Ada", lastName: "Lovelace" };

function mockSendResponse(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  });
}

/** Decodes the base64url `raw` field sent to Gmail back into the MIME text. */
function decodeRaw(rawArg: string): string {
  return Buffer.from(rawArg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function lastFetchBody(): { raw: string; threadId?: string } {
  const call = (global.fetch as jest.Mock).mock.calls[0];
  return JSON.parse(call[1].body);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  mockPrisma.startupInvestor.findUnique.mockResolvedValue(INVESTOR as never);
  mockPrisma.pipeline.findFirst.mockResolvedValue(null);
  mockPrisma.googleConnection.findUnique.mockResolvedValue(CONNECTION as never);
  mockPrisma.user.findUnique.mockResolvedValue(USER as never);
  mockPrisma.interactionLog.findFirst.mockResolvedValue(null);
  mockGetValidAccessToken.mockResolvedValue("access-token");
  mockPrisma.interactionLog.create.mockResolvedValue({} as never);
});

describe("sendInvestorEmail guard clauses", () => {
  it("throws INVESTOR_NOT_FOUND when the investor doesn't belong to the startup", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue(null);
    await expect(
      service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, { subject: "s", body: "b" }),
    ).rejects.toMatchObject({ code: "INVESTOR_NOT_FOUND" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws INVESTOR_EMAIL_MISSING rather than accepting any other recipient", async () => {
    mockPrisma.startupInvestor.findUnique.mockResolvedValue({ id: INVESTOR_ID, email: null } as never);
    await expect(
      service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, { subject: "s", body: "b" }),
    ).rejects.toMatchObject({ code: "INVESTOR_EMAIL_MISSING" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws PIPELINE_MISMATCH when the given deal belongs to a different contact", async () => {
    mockPrisma.pipeline.findUnique.mockResolvedValue({ startupInvestorId: "someone-else" } as never);
    await expect(
      service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, {
        pipelineId: PIPELINE_ID,
        subject: "s",
        body: "b",
      }),
    ).rejects.toMatchObject({ code: "PIPELINE_MISMATCH" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws GOOGLE_NOT_CONNECTED when there is no active connection", async () => {
    mockPrisma.googleConnection.findUnique.mockResolvedValue(null);
    await expect(
      service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, { subject: "s", body: "b" }),
    ).rejects.toMatchObject({ code: "GOOGLE_NOT_CONNECTED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("sendInvestorEmail the raw message", () => {
  it("addresses only the investor's stored email, regardless of anything else", async () => {
    mockSendResponse(200, { id: "msg-1", threadId: "thread-1" });

    await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, {
      subject: "Intro",
      body: "Hello",
    });

    const mime = decodeRaw(lastFetchBody().raw);
    expect(mime).toContain("To: investor@example.com");
  });

  it("sets From to the connected Google address, not the founder's login email", async () => {
    mockSendResponse(200, { id: "msg-1", threadId: "thread-1" });

    await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, {
      subject: "Intro",
      body: "Hello",
    });

    const mime = decodeRaw(lastFetchBody().raw);
    expect(mime).toContain("<founder@gmail.com>");
    expect(mime).toContain("Ada Lovelace");
  });

  it("base64-encodes the body and includes no In-Reply-To on a first email", async () => {
    mockSendResponse(200, { id: "msg-1", threadId: "thread-1" });

    await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, {
      subject: "Intro",
      body: "Hello there",
    });

    const mime = decodeRaw(lastFetchBody().raw);
    expect(mime).toContain("Content-Transfer-Encoding: base64");
    expect(mime).not.toContain("In-Reply-To");
    expect(mime).toMatch(/Message-ID: <.+@/);
  });

  it("threads a follow-up: sends the prior threadId and references the prior Message-ID", async () => {
    mockPrisma.interactionLog.findFirst.mockResolvedValue({
      gmailThreadId: "thread-prior",
      emailMessageId: "prior-id@localhost",
    } as never);
    mockSendResponse(200, { id: "msg-2", threadId: "thread-prior" });

    await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, {
      subject: "Re: Intro",
      body: "Following up",
    });

    const body = lastFetchBody();
    expect(body.threadId).toBe("thread-prior");
    const mime = decodeRaw(body.raw);
    expect(mime).toContain("In-Reply-To: <prior-id@localhost>");
    expect(mime).toContain("References: <prior-id@localhost>");
  });

  it("sends the access token as a bearer header to the Gmail send endpoint", async () => {
    mockSendResponse(200, { id: "msg-1", threadId: "thread-1" });

    await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, { subject: "s", body: "b" });

    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(call[1].headers.Authorization).toBe("Bearer access-token");
  });
});

describe("sendInvestorEmail deal linking", () => {
  it("uses the explicitly given pipelineId once it's verified", async () => {
    mockPrisma.pipeline.findUnique.mockResolvedValue({ startupInvestorId: INVESTOR_ID } as never);
    mockSendResponse(200, { id: "msg-1", threadId: "thread-1" });

    await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, {
      pipelineId: PIPELINE_ID,
      subject: "s",
      body: "b",
    });

    expect(mockPrisma.pipeline.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pipelineId: PIPELINE_ID }) }),
    );
  });

  it("falls back to the investor's active-round deal when no pipelineId is given", async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue({ id: "auto-deal" } as never);
    mockSendResponse(200, { id: "msg-1", threadId: "thread-1" });

    await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, { subject: "s", body: "b" });

    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pipelineId: "auto-deal" }) }),
    );
  });
});

describe("sendInvestorEmail failure ordering", () => {
  it("never writes a log when the send itself fails", async () => {
    mockSendResponse(502, "upstream error");

    await expect(
      service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, { subject: "s", body: "b" }),
    ).rejects.toMatchObject({ code: "GMAIL_SEND_FAILED" });

    expect(mockPrisma.interactionLog.create).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("writes exactly one log for a successful send", async () => {
    mockSendResponse(200, { id: "msg-1", threadId: "thread-1" });

    const result = await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, {
      subject: "s",
      body: "b",
    });

    expect(result).toEqual({ messageId: "msg-1", threadId: "thread-1", logCreated: true });
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "email",
          source: "gmail",
          externalId: "msg-1",
          gmailThreadId: "thread-1",
        }),
      }),
    );
  });

  it("never reports the send as failed when only the log write fails retries on the queue instead", async () => {
    mockSendResponse(200, { id: "msg-1", threadId: "thread-1" });
    mockPrisma.interactionLog.create.mockRejectedValue(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await service.sendInvestorEmail(STARTUP_ID, INVESTOR_ID, USER_ID, {
      subject: "s",
      body: "b",
    });

    expect(result).toEqual({ messageId: "msg-1", threadId: "thread-1", logCreated: false });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "gmail-log-retry",
      expect.objectContaining({ externalId: "msg-1", source: "gmail" }),
    );
  });
});
