# Background jobs

Queues, workers, and scheduled work. Two distinct mechanisms live here and they
run in **different processes**:

| Mechanism | Runs in | Purpose |
|---|---|---|
| BullMQ queues and workers | The **worker** process | Durable, retryable work triggered by a request or a schedule |
| `node-cron` schedules | Each **API** process | Periodic maintenance, reminders, and enqueueing |

The API enqueues but never processes. The worker processes but never serves
HTTP.

## Running them

```bash
docker compose up -d      # includes a worker container with LibreOffice
npm run worker            # host worker in watch mode (no LibreOffice)
```

**Run one, not both.** Two workers against the same Redis split jobs
unpredictably between them. Use the Docker worker when you need DOCX/PPTX
conversion; use the host worker when you want watch-mode reloads.

## Queues

Defined in `src/jobs/queue.ts`, named in `src/jobs/job-names.ts`. Queues are
lazily constructed so importing the module does not open a Redis connection.

Default job options for every queue:

```ts
{
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
}
```

**Every job must be idempotent.** Retries, process restarts, and multiple
consumers are normal operating conditions. The existing jobs demonstrate the
patterns: replace-then-write instead of append, `upsert` on a natural key,
`jobId` for deduplication, and generation checks for staleness.

## Workers

`src/jobs/workers/index.ts` starts one BullMQ `Worker` per definition and wires
`completed` / `failed` / `error` logging.

| Queue | Concurrency | Does | Why that concurrency |
|---|---:|---|---|
| `email` | 10 | Sends via Resend | IO-bound, cheap |
| `document-processing` | 2 | Parse → chunk → enqueue embeddings → promote | Provider-bound |
| `document-rasterize` | 1 | Convert Office → PDF, render pages to WebP | CPU-bound; would starve the IO-bound queues |
| `embeddings` | 5 | Batch-embed a version's chunks | Provider rate limits |
| `ai-analysis` | 2 | Run a pitch-deck analysis | Expensive model calls |
| `calendar-sync` | 3 | Pull Google Calendar events into interaction logs | Google quota is **per project**, not per connection — low concurrency keeps many connections from bursting it |
| `gmail-log-retry` | 5 | Re-record an interaction log for a sent Gmail message | Light |

### Idempotency in practice

| Job | Technique |
|---|---|
| `email` (reviewer invitations) | Compares `deliveryGeneration` against the invitation; a stale generation is skipped, not sent |
| `document-processing` | Deletes the version's chunks before inserting, inside one transaction |
| `gmail-log-retry` | `upsert` on the per-contact unique `externalId`, so a duplicate enqueue is safe rather than a 500 |
| `calendar-sync` (enqueue) | Fixed `jobId` of `calendar-sync:<userId>`, so an in-flight sync is reused instead of stacked |
| `document-rasterize` | Re-renders deterministically and overwrites page rows |

### Promotion is shared

`document-processing` and `document-rasterize` both call
`promoteNewestUsableDocumentVersion` on completion, because either can finish
first. See [documents.md](documents.md#promotion).

## Cron schedules

Defined in `src/jobs/cron.ts`, started by `server.ts` in **every** API replica.

### The lock

`startCronJobs()` runs once per API process, and there is no leader election —
so every replica's `node-cron` fires every schedule independently. `withCronLock`
closes that gap:

```ts
const bucket = Math.floor(Date.now() / intervalMs);
const acquired = await redis.set(`cron-lock:${name}:${bucket}`, "1", "PX", intervalMs, "NX");
if (!acquired) return;
```

Bucketing by wall-clock time means every replica computes the **same key for the
same logical tick** regardless of whose clock fires first. Only the replica that
wins the `SET NX` runs the body. The lock expires with the bucket, so a crash
mid-run never blocks the next legitimate tick.

### The schedules

| Cron | Name | What it does |
|---|---|---|
| `*/30 * * * *` | `pending-registration-cleanup` | Deletes `PendingRegistration` rows whose OTP has expired |
| `*/30 * * * *` | `stale-document-upload-cleanup` | Deletes `pending_upload` versions older than 1 hour, plus documents left with no versions |
| `*/30 * * * *` | `calendar-sync-enqueue` | Enqueues a sync per active connection with `calendarSyncEnabled`. **Only registered when the Google integration is configured** |
| `0 9 * * *` | `daily-reminders` | Overdue and due-today task notices, then stale-lead and no-next-step deal notices |
| `15 3 * * *` | `ai-chat-retention` | Deletes archived AI sessions past `AI_CHAT_RETENTION_DAYS`. **Only registered when that value is > 0** |
| `45 3 * * *` | `reviewer-data-retention` | Reviewer privacy retention; records success/failure metrics |

Notes on the design:

- **Upload cleanup exists because nothing else revisits an abandoned upload.**
  `createUploadSession` writes the rows before a single byte arrives; if the tab
  closes, the row would read "Uploading…" forever. An hour is far longer than
  any real upload at this size cap.
- **Calendar sync is every 30 minutes, not daily**, because a meeting is only
  useful on an investor's timeline soon after it happens.
- **The daily reminder pass runs the two halves in separate `try` blocks**, in a
  deliberate order: a dated task is more urgent than a deal nudge, and neither
  may take the other down.
- `notifyOverdueAndDueTodayTasks` skips tasks it has already notified about, so
  a re-run or a missed tick never duplicates a notice.

### Reminder thresholds

In `src/jobs/pipeline-reminders.ts`:

| Constant | Value | Meaning |
|---|---:|---|
| `STALE_LEAD_AFTER_DAYS` | 7 | A lead not spoken to in this long is the round's biggest risk |
| `NO_NEXT_STEP_GRACE_DAYS` | 3 | Grace before a deal with no open task counts as neglected — without it, every deal added this morning would be reported before anyone could give it a next step |
| `DEAL_REMINDER_COOLDOWN_DAYS` | see `notification.service.ts` | Suppresses repeat nudges for the same deal |

"Last touch" per investor takes the newer of `interactionDate` (what the founder
says happened) and `createdAt` (when it was written down), because logs recorded
before `interactionDate` existed only have the latter. The focus list uses the
same rule.

## Adding a job

1. Add the queue name to `JOB_NAMES`.
2. Create the queue in `queue.ts` with its data type, and add it to the
   `queues` array so `closeQueues()` covers it.
3. Write `src/jobs/workers/<name>.worker.ts` exporting
   `{ name, concurrency, process }`, and export the job data interface.
4. Register it in the `JOBS` array in `workers/index.ts`.
5. **Make it idempotent**, then say in a comment which technique you used.
6. Choose concurrency by what the job is bound by: IO/provider-bound can be
   high, CPU-bound should be 1–2 so it does not starve the rest.
7. Add a test under `tests/unit/<name>.worker.test.ts`.

## Adding a schedule

1. Add `cron.schedule(expr, …)` in `startCronJobs()`.
2. **Wrap the body in `withCronLock(name, intervalMs, fn)`** with an
   `intervalMs` that matches the cron expression — a mismatch either allows
   duplicate runs or blocks legitimate ones.
3. Wrap the work in `try`/`catch` and log with an `[cron]` prefix; a throwing
   schedule must not take the process down.
4. Gate on configuration where relevant, so an unconfigured deployment is not
   polling for nothing.
5. Document it in the table above.

## Operating

- Worker logs are structured: `{ worker, jobId }` on completion,
  `{ worker, jobId, err }` on failure.
- Failed jobs are retained (500 per queue) for inspection.
- The worker handles `SIGTERM`/`SIGINT`, closes every worker, then Redis and
  Prisma. An unhandled rejection exits non-zero so the supervisor restarts it.
- Scale the worker horizontally by queue depth; it holds no local state.
- Watch: queue depth, failure rate per queue, `reviewer_email_failed` log
  events, and `raise_reviewer_retention_last_success_timestamp_seconds`. See
  [operations.md](operations.md).
