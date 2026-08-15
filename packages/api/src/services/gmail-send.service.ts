import crypto from "crypto";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { getAppUrl } from "../config/env";
import { googleConnectionService } from "./google-connection.service";
import { gmailLogRetryQueue } from "../jobs/queue";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const DESCRIPTION_MAX = 2000;

function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function toBase64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function messageIdDomain(): string {
  try {
    return new URL(getAppUrl()).hostname;
  } catch {
    return "invalid.local";
  }
}

/**
 * Builds the base64url `raw` payload Gmail's `messages.send` expects. The body
 * is always base64-encoded regardless of content simpler and more robust
 * than picking 7bit vs quoted-printable based on what characters happen to be
 * in a founder's message.
 */
function buildRawMessage(input: {
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo: string | null;
}): string {
  const bodyBase64 = Buffer.from(input.body, "utf8").toString("base64");
  const wrappedBody = bodyBase64.match(/.{1,76}/g)?.join("\r\n") ?? bodyBase64;

  const headers = [
    `From: ${encodeHeaderValue(input.fromName)} <${input.fromEmail}>`,
    `To: ${input.toEmail}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `Message-ID: <${input.messageId}>`,
    ...(input.inReplyTo
      ? [`In-Reply-To: <${input.inReplyTo}>`, `References: <${input.inReplyTo}>`]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];

  return toBase64Url(Buffer.from([...headers, "", wrappedBody].join("\r\n"), "utf8"));
}

export interface SendInvestorEmailInput {
  pipelineId?: string;
  subject: string;
  body: string;
}

export interface SendInvestorEmailResult {
  messageId: string;
  threadId: string;
  /** False only if the send succeeded but the log write had to be retried on
   *  the queue the send itself is never rolled back or reported as failed. */
  logCreated: boolean;
}

export class GmailSendService {
  async sendInvestorEmail(
    startupId: string,
    investorId: string,
    userId: string,
    input: SendInvestorEmailInput,
  ): Promise<SendInvestorEmailResult> {
    const investor = await prisma.startupInvestor.findUnique({
      where: { startupId_id: { startupId, id: investorId } },
      select: { id: true, email: true },
    });
    if (!investor) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");
    // The only recipient this endpoint will ever address an investor with no
    // stored email has nowhere for the endpoint to send that isn't caller-supplied,
    // and accepting a caller-supplied "to" would turn this into an open relay
    // operating under the founder's own Gmail identity.
    if (!investor.email) {
      throw createError("This investor has no email on file", 422, "INVESTOR_EMAIL_MISSING");
    }

    if (input.pipelineId) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { startupId_id: { startupId, id: input.pipelineId } },
        select: { startupInvestorId: true },
      });
      if (!pipeline || pipeline.startupInvestorId !== investor.id) {
        throw createError(
          "Pipeline entry does not belong to this investor contact",
          422,
          "PIPELINE_MISMATCH",
        );
      }
    }

    const pipelineId = input.pipelineId ?? (await this.resolveActiveDeal(startupId, investor.id));

    const [connection, user] = await Promise.all([
      prisma.googleConnection.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }),
    ]);
    if (!connection || connection.status !== "active") {
      throw createError("Google account is not connected", 409, "GOOGLE_NOT_CONNECTED");
    }

    // Thread continuity: the most recent prior email to this same investor
    // (any deal the relationship, not the round, is what a thread follows)
    // supplies the References/threadId a reply needs to land in that thread
    // instead of starting a new one.
    const priorEmail = await prisma.interactionLog.findFirst({
      where: { startupInvestorId: investor.id, source: "gmail", gmailThreadId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { gmailThreadId: true, emailMessageId: true },
    });

    const accessToken = await googleConnectionService.getValidAccessToken(userId);

    const messageId = `${crypto.randomUUID()}@${messageIdDomain()}`;
    const raw = buildRawMessage({
      fromName: `${user!.firstName} ${user!.lastName}`.trim(),
      fromEmail: connection.googleEmail,
      toEmail: investor.email,
      subject: input.subject,
      body: input.body,
      messageId,
      inReplyTo: priorEmail?.emailMessageId ?? null,
    });

    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        raw,
        ...(priorEmail?.gmailThreadId && { threadId: priorEmail.gmailThreadId }),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw createError(
        `Google rejected the send (${res.status}): ${detail.slice(0, 300)}`,
        502,
        "GMAIL_SEND_FAILED",
      );
    }

    const sent = (await res.json()) as { id: string; threadId: string };

    const logData = {
      startupInvestorId: investor.id,
      pipelineId: pipelineId ?? null,
      createdBy: userId,
      type: "email" as const,
      source: "gmail" as const,
      externalId: sent.id,
      gmailThreadId: sent.threadId,
      emailMessageId: messageId,
      subject: input.subject,
      description:
        input.body.length > DESCRIPTION_MAX ? input.body.slice(0, DESCRIPTION_MAX) : input.body,
      interactionDate: new Date().toISOString(),
    };

    // The email is already sent and irreversible at this point a failure
    // here must never be reported to the founder as a failed send. Retry the
    // write on the queue instead; externalId's uniqueness makes that retry
    // idempotent even if it races a second attempt.
    let logCreated = true;
    try {
      await prisma.interactionLog.create({
        data: { ...logData, interactionDate: new Date(logData.interactionDate) },
      });
    } catch (err) {
      console.error("[gmail-send] log write failed after a successful send, retrying on queue:", err);
      await gmailLogRetryQueue.add("gmail-log-retry", logData);
      logCreated = false;
    }

    return { messageId: sent.id, threadId: sent.threadId, logCreated };
  }

  private async resolveActiveDeal(
    startupId: string,
    startupInvestorId: string,
  ): Promise<string | null> {
    const deal = await prisma.pipeline.findFirst({
      where: { startupId, startupInvestorId, round: { status: "active" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return deal?.id ?? null;
  }
}

export const gmailSendService = new GmailSendService();
