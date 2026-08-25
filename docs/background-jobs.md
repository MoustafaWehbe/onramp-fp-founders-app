# Background jobs

Queues, workers, and scheduled work — all of it BullMQ, all of it running in
the **worker** process. The API enqueues but never processes; the worker
processes but never serves HTTP. Periodic maintenance (retention sweeps, daily
reminders, and the like) is not a separate mechanism — it's a BullMQ queue
like any other, whose jobs happen to be produced on a recurring schedule
instead of by a request. See [Scheduled tasks](#scheduled-tasks) below.

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
| `scheduled-tasks` | 1 | Runs the six periodic maintenance jobs below | Infrequent (30 min to daily) and never overlap; one at a time is plenty |

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

## Scheduled tasks

Defined in `src/jobs/workers/scheduled-tasks.worker.ts`. There is no cron
running anywhere — each schedule is a BullMQ **Job Scheduler**
(`queue.upsertJobScheduler(...)`), which is Redis-native: the schedule itself
lives in Redis, not in a timer inside any process. Exactly one job instance is
produced per due tick regardless of how many API or worker replicas are
running, and only one worker instance ever claims it. `registerScheduledTasks()`
is called once, from `workers/index.ts`'s own entrypoint — never from the API
— and is safe to call again on every worker boot: `upsertJobScheduler` is an
idempotent upsert, not a create.

Each of the six is produced as its own **named job on the shared
`scheduled-tasks` queue** (see the workers table above); `scheduledTasksJob`'s
processor switches on `job.name` to dispatch to the right handler. A schedule's
own name doubles as its job name and its scheduler id — there is exactly one
of each, so nothing else is needed to keep them apart.

### The schedules

| Pattern | Name | What it does |
|---|---|---|
| `*/30 * * * *` | `pending-registration-cleanup` | Deletes `PendingRegistration` rows whose OTP has expired |
| `*/30 * * * *` | `stale-document-upload-cleanup` | Deletes `pending_upload` versions older than 1 hour, plus documents left with no versions |
| `*/30 * * * *` | `calendar-sync-enqueue` | Enqueues a sync per active connection with `calendarSyncEnabled`. **Only registered when the Google integration is configured** |
| `0 9 * * *` | `daily-reminders` | Overdue and due-today task notices, then stale-lead and no-next-step deal notices |
| `15 3 * * *` | `ai-chat-retention` | Deletes archived AI sessions past `AI_CHAT_RETENTION_DAYS`. **Only registered when that value is > 0** |
| `45 3 * * *` | `reviewer-data-retention` | Reviewer privacy retention; records success/failure metrics |

The two conditional schedules are skipped at registration when unconfigured,
so an unconfigured deployment isn't carrying a schedule for nothing — but each
one's *processor* re-checks its own condition too, since a schedule already
registered in Redis outlives the deploy that created it. A deployment that
turns `AI_CHAT_RETENTION_DAYS` back off, for instance, must not leave a stale
schedule still deleting sessions until someone remembers to unregister it.

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

1. Add the task's name to `SCHEDULED_TASK_NAMES` in `scheduled-tasks.worker.ts`.
2. Write the task body as its own function, wrapped in `try`/`catch` and
   logging with a `[scheduled-tasks]` prefix — a throwing task must not take
   the worker down. Add a `case` for it in `scheduledTasksJob.process`'s
   switch on `job.name`.
3. Register its schedule with `scheduledTasksQueue.upsertJobScheduler(...)` in
   `registerScheduledTasks()`, choosing a `pattern` (standard cron syntax).
4. Gate registration on configuration where relevant, so an unconfigured
   deployment is not carrying a schedule for nothing — and re-check the same
   condition inside the task body itself, since a schedule already registered
   in Redis outlives the deploy that created it (see ai-chat-retention or
   calendar-sync-enqueue for the pattern).
5. Document it in the table above.
6. Add coverage under `tests/unit/scheduled-tasks.worker.test.ts`: the task's
   own behavior, its dispatch from `job.name`, and its registration gating if
   it has one.

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
