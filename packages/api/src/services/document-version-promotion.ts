import { prisma } from "../db/prisma";

/**
 * Promotes the newest fully usable version without displacing a healthy
 * current version while either background pipeline is still running.
 *
 * `unsupported` is an expected render terminal state for files such as XLSX
 * and TXT: they remain valid vault/AI documents, but the reviewer API marks
 * them as unavailable for secure sharing.
 */
export async function promoteNewestUsableDocumentVersion(documentId: string) {
  const candidate = await prisma.documentVersion.findFirst({
    where: {
      documentId,
      processingStatus: "ready",
      renderStatus: { in: ["ready", "unsupported"] },
    },
    orderBy: { versionNumber: "desc" },
    select: { id: true, isCurrent: true },
  });

  if (!candidate || candidate.isCurrent) return candidate;

  await prisma.$transaction(async (tx) => {
    await tx.documentVersion.updateMany({
      where: { documentId, isCurrent: true, id: { not: candidate.id } },
      data: { isCurrent: false },
    });
    await tx.documentVersion.update({
      where: { id: candidate.id },
      data: { isCurrent: true },
    });
  });

  return candidate;
}
