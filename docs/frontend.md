# Frontend guide

How `packages/web` is organized, who owns which piece of state, and the
conventions a change is expected to follow.

## Stack

React 19, Vite, React Router 7, TanStack Query 5, Zustand 5, Tailwind CSS 4,
Radix primitives in a shadcn/ui-style `components/ui`, React Hook Form + Zod,
Recharts, dnd-kit, Framer Motion, Sonner for toasts, Axios.

## Layout

```text
packages/web/src/
├── main.tsx           Creates the QueryClient, mounts App
├── App.tsx            Router, AuthProvider, route tree, toast host
├── routes/            AppRoutes, ProtectedRoute, RequireWorkspace
├── layouts/           AppLayout (workspace shell), AuthLayout
├── pages/
│   ├── landing/       Public marketing pages
│   ├── auth/          Login, register, OTP, recovery, invite acceptance
│   ├── review/        External reviewer portal (no founder shell)
│   └── dashboard/     The workspace, one directory per module
├── components/
│   ├── ui/            Primitives (button, dialog, select, …)
│   ├── layout/        Sidebar, Header, PageHeader, GlobalSearch
│   ├── shared/        Cross-page pieces (EmptyState, StatTile, Markdown, …)
│   ├── mentions/      Mention rendering and entity unfurls
│   └── startup/       Startup switcher and creation
├── hooks/             useAuth, useWorkspace, usePermissions, useNotificationStream, useAiStream, …
├── lib/               API modules, query keys, stores, helpers, generated types
├── providers/         AuthProvider and its context
├── styles/            Tailwind entry (globals.css)
├── test/              Vitest suites
└── types/             Shared frontend types
```

## Routing

Route modules are lazy-loaded in `routes/index.tsx` behind a `Suspense`
fallback. Four boundaries:

| Boundary | Routes |
|---|---|
| Public marketing | `/`, `/pricing`, `/about` |
| Reviewer portal | `/review/:token`, `/review/workspace`, `/review/expired` |
| Public auth (`AuthLayout`) | `/auth/login`, `/auth/register`, `/auth/verify`, `/auth/forgot-password`, `/auth/reset-password`, `/accept-invite` |
| Founder app (`ProtectedRoute` → `AppLayout`) | `/dashboard`, `/notifications`, `/profile` |
| Founder app + workspace (`RequireWorkspace`) | `/pipeline`, `/investors`, `/chat`, `/fundraising`, `/documents`, `/ai`, `/team`, `/reviewers`, `/startup`, `/audit`, `/settings` |

### What the guards do — and do not do

- **`ProtectedRoute`** establishes only that a user is signed in. It redirects
  to `/auth/login`, preserving the attempted location in router state so the
  app can return there after sign-in. **It does not check workspace membership.**
- **`RequireWorkspace`** ensures a usable active workspace exists. It
  distinguishes three states deliberately: loading (spinner), error (retry
  panel — bouncing someone to the empty dashboard because the network hiccuped
  invites a duplicate startup), and no workspace (redirect to `/dashboard`,
  where an invitation can be accepted).
- **The API remains authoritative.** Membership and permission failures surface
  per request as 403s, not as route guards.

The reviewer portal deliberately lives outside the founder shell: no sidebar,
no workspace context, its own session cookie.

## State ownership

| State | Owner | Examples |
|---|---|---|
| Server state | TanStack Query | investors, pipeline, rounds, documents, chat, notifications, AI sessions |
| Durable UI preferences | Zustand + `localStorage` | preferred startup, active round per startup, funding chart range |
| Authentication | `AuthProvider` | current user, session bootstrap, sign-in/out |
| Route state | React Router | deep-linked deal, conversation, or document |
| Ephemeral component state | React | dialogs, forms, selection, drag |
| Chat drafts | `sessionStorage` (`lib/chat-drafts.ts`) | per-startup, per-conversation/thread draft and nonce |

**The Zustand store is a preference cache, never an authorization source.** Its
persisted key is `fp:app-store:v2` and it stores only
`preferredStartupId`, `activeRoundIds`, and `fundingChartRanges`. A stored
startup id may point at a workspace the user has since been removed from —
`useWorkspace` resolves what is actually open.

## Query keys

Every server-state key is built in `lib/query-keys.ts` via the `qk` object.
Never spell a key inline.

Rules the file exists to enforce:

- A key includes the startup id and any other scope needed to prevent
  cross-workspace cache reuse.
- Everything under `qk.pipeline(...)` stores the paginated envelope
  `{ data: PipelineEntry[] }`, never a bare array.
- Round-scoped keys normalize a missing round to `null`, so the same round
  always serializes the same way.

Both halves of a cache entry — the key **and** the stored shape — are part of
the contract. Dashboard, Pipeline, Investors, and Fundraising read the same
board; when the shape drifted, an optimistic `setQueryData` from one screen
missed the copy another screen was reading.

## API access

`lib/api-client.ts` creates the Axios instance:

- `baseURL: "/api/v1"`, `withCredentials: true` — cookies do the authenticating,
  so no token is ever stored in JavaScript.
- A `401` triggers **one** shared refresh (`POST /auth/refresh`) and retries the
  original request once (`_retry` guard).
- The refresh is serialized with the Web Locks API
  (`navigator.locks.request("fp:auth-refresh", …)`) when available, so multiple
  tabs do not race to rotate the same refresh token.

Above that sit handwritten per-domain modules — `investor-api.ts`,
`pipeline-api.ts`, `document-api.ts`, `chat-api.ts`, `ai-api.ts`,
`fundraising-api.ts`, `reviewer-api.ts`, and so on — that expose
domain-friendly functions. Their request and response types come from
`lib/api-types.ts`, generated from the OpenAPI contract:

```bash
npm run gen:api-types --workspace=@raise/web
```

Never hand-edit `api-types.ts`.

In development, Vite proxies `/api` to port 3000, keeping the browser on one
origin so cookies and SSE work without CORS exceptions.

## Realtime

`useNotificationStream()` is mounted once, high in the tree. It opens a single
`EventSource` on `/api/v1/notifications/stream` that carries **both**
notifications and team chat — the server multiplexes every realtime event for
the signed-in user onto that one connection.

The stream is a signal, not a data source. Each event invalidates the affected
queries and lets them refetch. Splicing pushed payloads into the cache would
create two code paths that can disagree, for no gain: the refetch is one
request against an endpoint that already exists. That is also what makes a
dropped or duplicated pub/sub message harmless.

Chat sends are optimistic:

- client-only delivery state lives in the query cache;
- a failed message stays visible and retryable;
- the retry reuses the same `clientNonce`, so the backend idempotency
  constraint prevents a duplicate.

AI generation uses its own stream (`useAiStream`) against the message stream
endpoint, with reconnect and replay. See [ai.md](ai.md).

## Permissions in the UI

`lib/permissions.ts` mirrors the backend role templates and `usePermissions()`
exposes the checks. Use them to render the right controls and read-only states —
hiding a button the user cannot use is better UX than a 403 toast.

**Frontend permission checks are presentation only.** The backend is
authoritative on every request. A UI check that is wrong is a UX bug; a missing
backend check is a security bug.

## UI conventions

- Primitives in `components/ui/` follow shadcn/ui conventions:
  `class-variance-authority` for variants, `cn()` = `twMerge(clsx(...))` for
  class merging.
- Radix `data-[state=open]` / `animate-in` transitions depend on the
  `tailwindcss-animate` plugin being registered via `@plugin 'tailwindcss-animate'`
  in `src/styles/globals.css`. If dropdown or dialog animations silently do
  nothing, check that declaration first.
- Tailwind 4 ships utilities like `line-clamp-*` without a separate plugin.
- **Do not animate `box-shadow`.** Multi-layer shadow values do not interpolate
  cleanly across a CSS transition and visibly snap. Use a static `shadow-*` plus
  `transition-colors` on `border-color`/`background-color` for state-based
  trigger styling — see the sidebar `UserMenu` and `StartupSwitcher` triggers.
- Every data surface needs loading, empty, error, permission-denied, and
  small-screen states. `components/shared/EmptyState.tsx` and
  `LoadingSpinner.tsx` exist for this.

## Adding a screen — checklist

1. Add the API module function in `lib/<domain>-api.ts` using generated types.
2. Add the query key to `lib/query-keys.ts` including the startup scope.
3. Build the page under `pages/dashboard/<Module>/`, reading server state
   through TanStack Query.
4. Gate controls with `usePermissions()`.
5. Register the route in `routes/index.tsx`, inside `RequireWorkspace` if it
   needs a startup.
6. Handle loading, empty, error, retry, permission, and mobile states.
7. Add a Testing Library test under `src/test/` for the user-visible behavior.

## Known issue

`lib/mock-data.ts` still exports the production pipeline stage display
configuration (`STAGES`, `getStage`, `DEFAULT_PROBABILITY_BY_STAGE`, and the
`PipelineStageId` type) alongside development fixtures, and roughly twenty
production modules import from it. Do not add new fixture dependencies there;
when working in that area, split the stable configuration into its own module.
