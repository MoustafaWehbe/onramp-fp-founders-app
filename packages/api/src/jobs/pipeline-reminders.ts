import { prisma } from "../db/prisma";
import { OPEN_ROUND_STATUSES } from "../config/crm";
import { notificationService } from "../services/notification.service";

/** A lead that has not been spoken to in this long is the round's biggest risk. */
const STALE_LEAD_AFTER_DAYS = 7;

/**
 * Grace period before a deal with no open task counts as neglected. Without
 * it, every deal added this morning would be reported as having no next step
 * before anyone had a chance to give it one.
 */
const NO_NEXT_STEP_GRACE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Most recent contact per investor. interactionDate is what the founder says
 * happened; createdAt is when it was written down. Logs recorded before
 * interactionDate existed only have the latter, so both are taken and the
 * newer wins the same rule the focus list uses.
 */
async function lastTouchByInvestor(investorIds: string[]): Promise<Map<string, number>> {
  if (investorIds.length === 0) return new Map();

  const [byInteractionDate, byCreatedAt] = await Promise.all([
    prisma.interactionLog.groupBy({
      by: ["startupInvestorId"],
      where: { startupInvestorId: { in: investorIds }, interactionDate: { not: null } },
      _max: { interactionDate: true },
    }),
    prisma.interactionLog.groupBy({
      by: ["startupInvestorId"],
      where: { startupInvestorId: { in: investorIds } },
      _max: { createdAt: true },
    }),
  ]);

  const map = new Map<string, number>();
  const record = (investorId: string, value: Date | null) => {
    if (!value) return;
    const time = value.getTime();
    const current = map.get(investorId);
    if (current === undefined || time > current) map.set(investorId, time);
  };

  for (const row of byInteractionDate) record(row.startupInvestorId, row._max.interactionDate);
  for (const row of byCreatedAt) record(row.startupInvestorId, row._max.createdAt);
  return map;
}

/**
 * Who hears about a deal going quiet: whoever owns it, or the founder who
 * created the workspace when nobody does. An unowned deal drifting is exactly
 * the case worth surfacing, so it must not fall through for want of a
 * recipient but only to someone who is still an active member.
 */
function recipientFor(
  deal: { startupId: string; owner: { userId: string | null } | null },
  fallbackByStartup: Map<string, string | null>,
): string | null {
  if (deal.owner?.userId) return deal.owner.userId;
  return fallbackByStartup.get(deal.startupId) ?? null;
}

/**
 * Reminds a team about the two ways a raise stalls silently: a lead investor
 * nobody has spoken to in a week, and a live deal carrying no next step at
 * all. Settled deals (committed/passed) and deals in a finished round are
 * never chased. Safe to run repeatedly notifyLeadStale and
 * notifyDealNoNextStep hold a per-deal cooldown, so a daily tick does not
 * repeat itself.
 */
export async function notifyStaleLeadsAndIdleDeals(): Promise<void> {
  const deals = await prisma.pipeline.findMany({
    where: {
      stage: { notIn: ["committed", "passed"] },
      round: { status: { in: [...OPEN_ROUND_STATUSES] } },
    },
    select: {
      id: true,
      startupId: true,
      startupInvestorId: true,
      isLead: true,
      createdAt: true,
      owner: { select: { userId: true } },
      startupInvestor: { select: { fullName: true } },
    },
  });
  if (deals.length === 0) return;

  const pipelineIds = deals.map((deal) => deal.id);
  const startupIds = [...new Set(deals.map((deal) => deal.startupId))];

  const [openTasks, lastTouch, startups] = await Promise.all([
    prisma.task.findMany({
      where: { pipelineId: { in: pipelineIds }, status: "open" },
      select: { pipelineId: true },
      distinct: ["pipelineId"],
    }),
    lastTouchByInvestor([...new Set(deals.map((deal) => deal.startupInvestorId))]),
    prisma.startup.findMany({
      where: { id: { in: startupIds } },
      select: {
        id: true,
        createdBy: true,
        members: { where: { status: "active" }, select: { userId: true } },
      },
    }),
  ]);

  const hasOpenTask = new Set(openTasks.map((task) => task.pipelineId));
  const fallbackByStartup = new Map<string, string | null>(
    startups.map((startup) => [
      startup.id,
      startup.members.some((member) => member.userId === startup.createdBy)
        ? startup.createdBy
        : null,
    ]),
  );

  const now = Date.now();

  for (const deal of deals) {
    const userId = recipientFor(deal, fallbackByStartup);
    if (!userId) continue;

    // A deal never contacted is measured from the day it joined the board, so
    // an investor nobody ever reached out to still ages into the reminder.
    const since = lastTouch.get(deal.startupInvestorId) ?? deal.createdAt.getTime();
    const daysQuiet = Math.max(0, Math.floor((now - since) / DAY_MS));
    const daysOnBoard = Math.max(0, Math.floor((now - deal.createdAt.getTime()) / DAY_MS));
    const investorName = deal.startupInvestor.fullName;

    // A quiet lead is the more urgent fact about the same deal, so it wins;
    // the missing next step is reported for everything else.
    if (deal.isLead && daysQuiet >= STALE_LEAD_AFTER_DAYS) {
      await notificationService.notifyLeadStale({
        userId,
        startupId: deal.startupId,
        pipelineId: deal.id,
        investorName,
        daysQuiet,
      });
      continue;
    }

    if (!hasOpenTask.has(deal.id) && daysOnBoard >= NO_NEXT_STEP_GRACE_DAYS) {
      await notificationService.notifyDealNoNextStep({
        userId,
        startupId: deal.startupId,
        pipelineId: deal.id,
        investorName,
      });
    }
  }
}
