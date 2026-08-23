# Reviewer portal operations

The reviewer portal exposes a Prometheus-compatible `GET /metrics` endpoint.
It is disabled by default. To enable it, set:

```dotenv
METRICS_ENABLED=true
METRICS_TOKEN=<a dedicated random token of at least 32 characters>
```

Scrapers must send `Authorization: Bearer <token>`. Keep the endpoint on a
private network even with authentication. Metric labels are deliberately
bounded and never include emails, IP addresses, invitation IDs, session IDs,
document IDs, or startup IDs.

Useful signals include reviewer HTTP status and latency by operation, scoped
rate-limit rejections, reviewer retention outcomes, records redacted/deleted,
and the last successful retention timestamp. Recommended starting alerts are:

- no successful retention run for 48 hours;
- reviewer access or verification 5xx responses above 1% for 10 minutes;
- reviewer download/page 5xx responses above 1% for 10 minutes;
- a sustained increase in access or download rate-limit hits;
- email worker log events with `event=reviewer_email_failed`.

The daily retention job runs at 03:45 in the API process and uses the shared
Redis cron lock, so only one replica performs the work. Its defaults are:

| Data | Default | Action |
|---|---:|---|
| Expired, unverified access challenges | 24 hours | Delete session challenge |
| Session IP/user agent and visit hashes/referrer | 30 days | Redact fields |
| Detailed page-view rows | 365 days | Delete rows |
| Copy/print/screenshot security events | 365 days | Delete rows |

Invitations, reviewer comments, and aggregate visit results are preserved.
Configure the windows with `REVIEWER_CHALLENGE_RETENTION_HOURS`,
`REVIEWER_NETWORK_RETENTION_DAYS`, `REVIEWER_ENGAGEMENT_RETENTION_DAYS`, and
`REVIEWER_EVENT_RETENTION_DAYS`. Every value must be a positive integer; the
API validates them at startup.
