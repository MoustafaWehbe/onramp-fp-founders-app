import { Prisma } from "@prisma/client";
import { getAiConfig, type AiConfig } from "../config/ai";
import { prisma } from "../db/prisma";
import type { AiProvider } from "./ai-provider.service";
import { OpenAiProvider } from "./ai-provider.service";

type RetrievedChunkRow = {
  chunkId: string;
  content: string;
  tokenCount: number | null;
  pageNumber: number | null;
  sectionLabel: string | null;
  charStart: number | null;
  charEnd: number | null;
  documentId: string;
  documentVersionId: string;
  documentTitle: string;
  versionNumber: number;
  score: number;
};

export interface RetrievedDocumentChunk {
  chunkId: string;
  content: string;
  tokenCount: number;
  score: number;
  citation: {
    sourceType: "document_chunk";
    sourceId: string;
    documentChunkId: string;
    label: string;
    excerpt: string;
    metadata: {
      documentId: string;
      documentVersionId: string;
      versionNumber: number;
      sectionLabel: string | null;
      pageNumber: number | null;
      charStart: number | null;
      charEnd: number | null;
    };
  };
}

export interface RetrieveDocumentContextInput {
  startupId: string;
  query: string;
  pinnedDocumentVersionIds?: string[];
  signal?: AbortSignal;
}

function excerpt(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length <= 600 ? normalized : `${normalized.slice(0, 597)}...`;
}

function isNearDuplicate(candidate: RetrievedChunkRow, selected: RetrievedChunkRow[]): boolean {
  const fingerprint = candidate.content.replace(/\s+/g, " ").trim().slice(0, 400).toLowerCase();
  return selected.some((existing) => {
    const existingFingerprint = existing.content.replace(/\s+/g, " ").trim().slice(0, 400).toLowerCase();
    if (fingerprint && fingerprint === existingFingerprint) return true;
    if (candidate.documentVersionId !== existing.documentVersionId || candidate.charStart == null || candidate.charEnd == null || existing.charStart == null || existing.charEnd == null) return false;
    const overlap = Math.max(0, Math.min(candidate.charEnd, existing.charEnd) - Math.max(candidate.charStart, existing.charStart));
    const shortest = Math.min(candidate.charEnd - candidate.charStart, existing.charEnd - existing.charStart);
    return shortest > 0 && overlap / shortest >= 0.6;
  });
}

export class AiRetrievalService {
  constructor(private readonly provider: AiProvider = new OpenAiProvider(), private readonly config: AiConfig = getAiConfig()) {}

  async retrieveDocumentContext(input: RetrieveDocumentContextInput): Promise<RetrievedDocumentChunk[]> {
    const pinnedVersionIds = [...new Set(input.pinnedDocumentVersionIds ?? [])];
    if (pinnedVersionIds.length > 10) throw new Error("A session can pin at most 10 document versions");

    const embedding = await this.provider.embedQuery(input.query, input.signal);
    const vector = `[${embedding.join(",")}]`;
    const candidates = await prisma.$queryRaw<RetrievedChunkRow[]>(Prisma.sql`
      SELECT
        chunk.id AS "chunkId", chunk.content, chunk.token_count AS "tokenCount",
        chunk.page_number AS "pageNumber", chunk.section_label AS "sectionLabel",
        chunk.char_start AS "charStart", chunk.char_end AS "charEnd",
        document.id AS "documentId", version.id AS "documentVersionId",
        document.title AS "documentTitle", version.version_number AS "versionNumber",
        1 - (chunk.embedding <=> ${vector}::vector) AS score
      FROM "document_chunks" AS chunk
      INNER JOIN "document_versions" AS version ON version.id = chunk.document_version_id
      INNER JOIN "documents" AS document ON document.id = version.document_id
      WHERE document.startup_id = ${input.startupId}
        AND version.processing_status = 'ready'
        AND chunk.embedding IS NOT NULL
        ${pinnedVersionIds.length ? Prisma.sql`AND version.id IN (${Prisma.join(pinnedVersionIds)})` : Prisma.empty}
        AND 1 - (chunk.embedding <=> ${vector}::vector) >= ${this.config.minimumRetrievalScore}
      ORDER BY chunk.embedding <=> ${vector}::vector ASC
      LIMIT ${this.config.retrievalResultCount * 3}
    `);

    const selected: RetrievedChunkRow[] = [];
    let usedTokens = 0;
    for (const candidate of candidates) {
      const tokenCount = candidate.tokenCount ?? Math.ceil(candidate.content.length / 4);
      if (isNearDuplicate(candidate, selected)) continue;
      if (usedTokens + tokenCount > this.config.retrievalTokenBudget) continue;
      selected.push(candidate);
      usedTokens += tokenCount;
      if (selected.length === this.config.retrievalResultCount) break;
    }

    return selected.map((chunk) => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      tokenCount: chunk.tokenCount ?? Math.ceil(chunk.content.length / 4),
      score: Number(chunk.score),
      citation: {
        sourceType: "document_chunk",
        sourceId: chunk.chunkId,
        documentChunkId: chunk.chunkId,
        label: `${chunk.documentTitle} · v${chunk.versionNumber}${chunk.sectionLabel ? ` · ${chunk.sectionLabel}` : ""}`,
        excerpt: excerpt(chunk.content),
        metadata: {
          documentId: chunk.documentId,
          documentVersionId: chunk.documentVersionId,
          versionNumber: chunk.versionNumber,
          sectionLabel: chunk.sectionLabel,
          // The UI may show this only when parsing populated it never infer one.
          pageNumber: chunk.pageNumber,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
        },
      },
    }));
  }
}

export const aiRetrievalService = new AiRetrievalService();
