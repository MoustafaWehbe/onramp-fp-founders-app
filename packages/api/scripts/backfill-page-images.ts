import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { documentRasterizeQueue } from "../src/jobs/queue";

/**
 * Enqueues rasterization for PDF versions uploaded before the secure viewer
 * existed.
 *
 * Those rows have no `document_pages`, so the reviewer portal reports them as
 * "still being prepared" forever — the render job only ran on upload confirm.
 * The migration deliberately left them `render_status = 'pending'` so this
 * script can find them.
 *
 *   npm run db:backfill-pages -w packages/api -- --dry-run
 *   npm run db:backfill-pages -w packages/api -- --limit 50
 *   npm run db:backfill-pages -w packages/api -- --retry-failed
 *
 * Safe to re-run: the worker deletes and rewrites a version's pages, and
 * versions already rendered are skipped unless --force is passed.
 */

type Options = {
  dryRun: boolean;
  limit: number | null;
  retryFailed: boolean;
  force: boolean;
};

function parseArgs(argv: string[]): Options {
  const limitIndex = argv.indexOf("--limit");
  const rawLimit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) : NaN;

  return {
    dryRun: argv.includes("--dry-run"),
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : null,
    retryFailed: argv.includes("--retry-failed"),
    force: argv.includes("--force"),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // 'unsupported' is excluded on purpose: those are non-PDFs, and re-queueing
  // them would just burn worker time to reach the same conclusion.
  const renderStatuses = options.force
    ? ["pending", "rendering", "failed", "ready"]
    : options.retryFailed
      ? ["pending", "failed"]
      : ["pending"];

  const versions = await prisma.documentVersion.findMany({
    where: {
      mimeType: "application/pdf",
      // A version whose upload never completed has no object to read.
      processingStatus: { not: "pending_upload" },
      renderStatus: { in: renderStatuses },
    },
    select: {
      id: true,
      documentId: true,
      renderStatus: true,
      originalFilename: true,
      document: { select: { startupId: true, title: true } },
    },
    orderBy: { createdAt: "asc" },
    ...(options.limit ? { take: options.limit } : {}),
  });

  if (versions.length === 0) {
    console.info("Nothing to backfill — no PDF versions are awaiting rasterization.");
    return;
  }

  console.info(
    `${options.dryRun ? "[dry run] " : ""}${versions.length} version(s) to rasterize ` +
      `(render_status in ${renderStatuses.join(", ")})`,
  );

  for (const version of versions) {
    console.info(
      `  ${version.document.title} — ${version.originalFilename} ` +
        `[${version.renderStatus}] ${version.id}`,
    );
    if (options.dryRun) continue;

    await documentRasterizeQueue.add("rasterize-version", {
      startupId: version.document.startupId,
      documentId: version.documentId,
      versionId: version.id,
    });
  }

  if (options.dryRun) {
    console.info("\nDry run — nothing was queued. Re-run without --dry-run to enqueue.");
    return;
  }

  console.info(
    `\nQueued ${versions.length} job(s). The worker must be running ` +
      `(npm run worker -w packages/api) for them to be processed.`,
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await documentRasterizeQueue.close();
    // Importing the queue barrel constructs every queue in the app, and they
    // all share one ioredis connection that no single queue's close() releases,
    // so the script would otherwise hang after finishing its work. Quitting the
    // shared connection is not the answer either — the still-attached queues
    // then emit connection errors that surface as an unhandled rejection.
    // Exiting outright is the clean end for a one-shot script.
    process.exit(process.exitCode ?? 0);
  });
