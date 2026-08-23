# Raise documentation

Everything needed to understand, run, extend, and operate Raise. Start with the
row that matches what you are trying to do.

| I want to… | Read |
|---|---|
| Understand what the product does | [Feature guide](features.md) |
| Run it locally for the first time | [Getting started](getting-started.md) |
| Understand how the system fits together | [Architecture](architecture.md) |
| Add or change an API endpoint | [Backend guide](backend.md) → [API reference](api-reference.md) |
| Add or change a screen | [Frontend guide](frontend.md) |
| Change the database | [Data model](data-model.md) |
| Understand auth, roles, or tenancy | [Security model](security.md) |
| Work on documents, uploads, or storage | [Documents and storage](documents.md) |
| Work on the external reviewer data room | [Reviewer portal](reviewer-portal.md) |
| Work on AI chat, analysis, or retrieval | [AI subsystem](ai.md) |
| Work on queues, workers, or schedules | [Background jobs](background-jobs.md) |
| Set an environment variable | [Configuration reference](configuration.md) |
| Deploy, scale, monitor, or respond to an incident | [Operations](operations.md) |
| Write or run tests | [Testing](testing.md) |
| Open a pull request | [Contributing](contributing.md) |
| Fix something that is behaving strangely | [Troubleshooting](troubleshooting.md) |
| Look up a domain term | [Glossary](glossary.md) |

## Document map

### Orientation

- **[Feature guide](features.md)** — what each module of the product does, who
  can use it, and where it lives in the code.
- **[Glossary](glossary.md)** — fundraising and system vocabulary, including
  the exact enum values the code uses.

### Building

- **[Getting started](getting-started.md)** — prerequisites, setup, seed data,
  and the day-to-day command list.
- **[Architecture](architecture.md)** — runtime components, boundaries, request
  and event flows, and the rules that keep them intact.
- **[Backend guide](backend.md)** — the API's layering, error model,
  validation, pagination, and the recipe for adding a resource.
- **[Frontend guide](frontend.md)** — routing, state ownership, query keys,
  API modules, realtime, and UI conventions.
- **[Data model](data-model.md)** — schema domains, key invariants, and the
  migration workflow.
- **[API reference](api-reference.md)** — every endpoint with its auth and
  permission requirements.

### Subsystems

- **[Security model](security.md)** — sessions, RBAC, multi-tenancy, abuse
  controls, and secret handling.
- **[Documents and storage](documents.md)** — the two-phase upload, processing
  pipeline, versioning, and access paths.
- **[Reviewer portal](reviewer-portal.md)** — external data-room access,
  controls, telemetry, and privacy retention.
- **[AI subsystem](ai.md)** — grounding, tools, propose-only actions,
  streaming, and capacity limits.
- **[Background jobs](background-jobs.md)** — queues, workers, and cron
  schedules.

### Running it

- **[Configuration reference](configuration.md)** — every environment
  variable, its default, and when it is required.
- **[Operations](operations.md)** — deployment topology, release steps, health
  probes, metrics, alerts, and runbooks.
- **[Testing](testing.md)** — the test layers and what coverage is expected.
- **[Contributing](contributing.md)** — branch, review, and merge workflow.
- **[Troubleshooting](troubleshooting.md)** — known failure modes and fixes.

## Other sources of truth

| Source | Role |
|---|---|
| [`packages/api/openapi.yaml`](../packages/api/openapi.yaml) | The REST contract of record. Served at `/api/docs`. |
| [`packages/api/prisma/schema.prisma`](../packages/api/prisma/schema.prisma) | The database schema of record. |
| [`packages/api/.env.example`](../packages/api/.env.example) | The canonical, commented environment variable list. |
| [`AGENTS.md`](../AGENTS.md) | Condensed conventions for AI coding agents. |

## Keeping these docs true

Documentation drift is a bug. When a change alters any of the following, update
the matching page in the same pull request:

| Change | Update |
|---|---|
| A system boundary or runtime component | [architecture.md](architecture.md) |
| An endpoint, payload, or permission | `openapi.yaml` + [api-reference.md](api-reference.md) |
| A schema model or invariant | [data-model.md](data-model.md) |
| An environment variable | `.env.example` + [configuration.md](configuration.md) |
| A queue, worker, or schedule | [background-jobs.md](background-jobs.md) |
| A retention window or alert threshold | [operations.md](operations.md) |
| A user-visible capability | [features.md](features.md) |
