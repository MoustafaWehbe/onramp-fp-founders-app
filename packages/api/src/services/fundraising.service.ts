import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import type {
  CreateCommitmentInput,
  CreateFundraisingRoundInput,
  ListCommitmentsQuery,
  ListFundraisingRoundsQuery,
  UpdateCommitmentInput,
  UpdateFundraisingRoundInput,
} from "../validators/fundraising.schemas";

const INVESTOR_SELECT = {
  id: true,
  startupId: true,
  fullName: true,
  email: true,
  ventureFirm: true,
  investorType: true,
  sectorFocus: true,
  investmentStagePreference: true,
  linkedinUrl: true,
  notes: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ROUND_SELECT = {
  id: true,
  startupId: true,
  roundName: true,
  targetAmount: true,
  minimumTicketSize: true,
  equityOfferedPercentage: true,
  currency: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const COMMITMENT_SELECT = {
  id: true,
  startupId: true,
  startupInvestorId: true,
  pipelineId: true,
  roundId: true,
  amount: true,
  status: true,
  expectedCloseDate: true,
  createdAt: true,
  updatedAt: true,
  startupInvestor: { select: INVESTOR_SELECT },
} as const;

function asNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

function serializeRound(round: Prisma.FundraisingRoundGetPayload<{ select: typeof ROUND_SELECT }>) {
  return {
    ...round,
    targetAmount: asNumber(round.targetAmount),
    minimumTicketSize: asNumber(round.minimumTicketSize),
    equityOfferedPercentage: asNumber(round.equityOfferedPercentage),
  };
}

function serializeCommitment(
  commitment: Prisma.CommitmentGetPayload<{ select: typeof COMMITMENT_SELECT }>,
) {
  const { startupInvestorId, startupInvestor, ...rest } = commitment;
  return {
    ...rest,
    investorId: startupInvestorId,
    investor: startupInvestor,
    amount: asNumber(commitment.amount),
  };
}

export class FundraisingService {
  async listRounds(startupId: string, query: ListFundraisingRoundsQuery) {
    const where = { startupId, ...(query.status && { status: query.status }) };
    const [total, rounds] = await Promise.all([
      prisma.fundraisingRound.count({ where }),
      prisma.fundraisingRound.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: ROUND_SELECT,
      }),
    ]);
    return {
      data: rounds.map(serializeRound),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async getRound(startupId: string, roundId: string) {
    const round = await prisma.fundraisingRound.findUnique({
      where: { startupId_id: { startupId, id: roundId } },
      select: ROUND_SELECT,
    });
    if (!round) throw createError("Fundraising round not found", 404, "FUNDRAISING_ROUND_NOT_FOUND");
    return serializeRound(round);
  }

  async createRound(startupId: string, input: CreateFundraisingRoundInput) {
    const round = await prisma.fundraisingRound.create({
      data: { startupId, ...input },
      select: ROUND_SELECT,
    });
    return serializeRound(round);
  }

  async updateRound(startupId: string, roundId: string, input: UpdateFundraisingRoundInput) {
    await this.getRound(startupId, roundId);
    const round = await prisma.fundraisingRound.update({
      where: { id: roundId },
      data: input,
      select: ROUND_SELECT,
    });
    return serializeRound(round);
  }

  async deleteRound(startupId: string, roundId: string) {
    await this.getRound(startupId, roundId);
    const [pipelineCount, commitmentCount] = await Promise.all([
      prisma.pipeline.count({ where: { startupId, roundId } }),
      prisma.commitment.count({ where: { startupId, roundId } }),
    ]);
    if (pipelineCount || commitmentCount) {
      throw createError(
        "This fundraising round has pipeline entries or commitments and cannot be deleted",
        409,
        "HAS_DEPENDENTS",
      );
    }
    await prisma.fundraisingRound.delete({ where: { id: roundId } });
  }

  async listCommitments(startupId: string, query: ListCommitmentsQuery, roundId?: string) {
    if (roundId) await this.getRound(startupId, roundId);
    const where = {
      startupId,
      ...(roundId && { roundId }),
      ...(query.status && { status: query.status }),
    };
    const [total, commitments] = await Promise.all([
      prisma.commitment.count({ where }),
      prisma.commitment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: COMMITMENT_SELECT,
      }),
    ]);
    return {
      data: commitments.map(serializeCommitment),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async getCommitment(startupId: string, commitmentId: string) {
    const commitment = await prisma.commitment.findFirst({
      where: { id: commitmentId, startupId },
      select: COMMITMENT_SELECT,
    });
    if (!commitment) throw createError("Commitment not found", 404, "COMMITMENT_NOT_FOUND");
    return serializeCommitment(commitment);
  }

  async createCommitment(startupId: string, input: CreateCommitmentInput) {
    const [investor, round, pipeline] = await Promise.all([
      prisma.startupInvestor.findUnique({
        where: { startupId_id: { startupId, id: input.investorId } },
        select: { id: true },
      }),
      prisma.fundraisingRound.findUnique({
        where: { startupId_id: { startupId, id: input.roundId } },
        select: { id: true },
      }),
      prisma.pipeline.findFirst({
        where: {
          id: input.pipelineId,
          startupId,
          roundId: input.roundId,
          startupInvestorId: input.investorId,
        },
        select: { id: true },
      }),
    ]);
    if (!investor) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");
    if (!round) throw createError("Fundraising round not found", 404, "FUNDRAISING_ROUND_NOT_FOUND");
    if (!pipeline) {
      throw createError(
        "Pipeline entry must belong to the selected investor and fundraising round",
        422,
        "PIPELINE_MISMATCH",
      );
    }
    const commitment = await prisma.commitment.create({
      data: {
        startupId,
        startupInvestorId: input.investorId,
        pipelineId: input.pipelineId,
        roundId: input.roundId,
        amount: input.amount,
        ...(input.status && { status: input.status }),
        ...(input.expectedCloseDate && { expectedCloseDate: input.expectedCloseDate }),
      },
      select: COMMITMENT_SELECT,
    });
    return serializeCommitment(commitment);
  }

  async updateCommitment(startupId: string, commitmentId: string, input: UpdateCommitmentInput) {
    await this.getCommitment(startupId, commitmentId);
    const commitment = await prisma.commitment.update({
      where: { id: commitmentId },
      data: input,
      select: COMMITMENT_SELECT,
    });
    return serializeCommitment(commitment);
  }

  async deleteCommitment(startupId: string, commitmentId: string) {
    await this.getCommitment(startupId, commitmentId);
    await prisma.commitment.delete({ where: { id: commitmentId } });
  }
}

export const fundraisingService = new FundraisingService();
