# Blotato — Multi-Platform Comment System

Read comments on published posts and reply to them, across social platforms,
behind one REST API.

NestJS · TypeScript · Postgres 16 (TypeORM, hand-written migrations)

---

## How it works

Comments live in **our** database, not on the platform. Reads hit Postgres.
A poller keeps the mirror fresh. Replies are written locally first and
delivered out of band by a dispatcher.

```mermaid
flowchart TB
    C([Client])

    subgraph API
      R["GET comments<br/>(mirror read)"]
      W["POST reply<br/>→ 202 pending"]
    end

    DB[("Postgres<br/>comments = mirror + outbox")]

    subgraph Workers
      P["Poller<br/>claims due posts"]
      D["Dispatcher<br/>claims due replies"]
    end

    A["Platform adapters<br/>capabilities as data"]
    S(["X · Instagram"])

    C --> R --> DB
    C --> W --> DB
    P --> DB
    D --> DB
    P --> A
    D --> A
    A <--> S
    A -->|upsert mirrored| DB
```

Everything else in this document follows from that shape:

| | How it behaves |
|---|---|
| **Read path** | Client → Postgres. One indexed query, no platform call. |
| **Write path** | Client → `pending` row → `202`. The dispatcher delivers, retries and records. |
| **Platform layer** | Adapters behind one interface; differences expressed as **capability data**, never as `if (platform === …)`. |

---

## Contents

- [Run it](#run-it)
- [Why a mirror](#why-a-mirror)
- [Why an outbox](#why-an-outbox)
- [Platforms](#platforms)
- [API](#api)
- [Data model](#data-model)
- [Tests](#tests)
- [AI usage](#ai-usage)
- [What I'd build next](#what-id-build-next)

---

## Run it

```bash
npm install
docker compose up -d          # Postgres on :55432
cp .env.example .env
npm run migration:run
npm run demo                  # boots the API with a seeded thread
```

`npm run demo` prints ready-to-paste `curl` commands. Swagger is at `/docs`.

```bash
npm test        # 25 unit tests, no database needed
npm run typecheck
```

The demo runs against a `fake` adapter implementing the same interface as the
real ones, so sync, threading, pagination, the outbox and its dispatcher are all
exercisable without credentials. It is opt-in (`ENABLE_FAKE_PLATFORM`, set by the
demo itself) and never registered under `NODE_ENV=production`.

---

## Why a mirror

`GET /v1/posts/:id/comments` reads Postgres. Proxying to the platform looks
simpler and breaks quickly:

- **Rate limits are per connected account, and publishing needs that budget.**
  Refreshing a busy post should not cost a scheduled post.
- **Every platform paginates differently** — X opaque tokens, Instagram Graph
  cursors, LinkedIn offsets. One API cursor across all of them is impossible if
  the cursor has to be theirs.
- **Reads would inherit platform latency and downtime.**
- **Cross-post questions become answerable.** "Every unanswered comment across
  all my posts" is `GET /v1/comments?unansweredOnly=true` — it spans posts and
  platforms, so no upstream API could serve it at any number of requests.

The cost is staleness, so staleness is reported rather than hidden:

```json
"meta": { "syncedAt": "2026-08-11T13:37:07Z", "stale": false }
```

`?refresh=true` forces a live pull first. If that pull fails the request still
returns cached comments with `meta.syncError` set — a slightly stale answer beats
a 502, as long as the caller is told.

**Polling is adaptive.** Comment activity decays with post age, so the interval
scales with it (1 min under an hour old → 6 h after a week), ×10 where webhooks
exist and polling is only a reconciliation net. Cost tracks *active* posts, not
every post ever published.

---

## Why an outbox

`POST /v1/comments/:id/replies` writes a row with `delivery_status = 'pending'`
and returns **202**. A dispatcher delivers it.

Inline delivery fails three ways: a platform timeout becomes a 30-second HTTP
request, a 429 becomes the user's problem to retry by hand, and a network failure
*after* the platform accepted the write becomes a duplicate public comment.

The reply row **is** the queue entry **and** the comment:

- one INSERT accepts and enqueues — never one without the other
- it appears in its thread instantly, in position
- `Idempotency-Key` on a unique index makes a retried POST return the original

| Mechanism | Effect |
|---|---|
| `FOR UPDATE SKIP LOCKED` claim | Scales horizontally, no broker or lock service. The poller claims the same way. |
| Claim pushes next-attempt forward | Visibility timeout: a worker that dies mid-delivery releases its rows |
| Backoff with **full jitter** | An outage fails every reply at once; jitter stops them retrying in the same instant |
| Terminal vs. retryable split | Revoked token, rejected body, or a write accepted without an id fail immediately instead of burning attempts |

---

## Platforms

An adapter implements two methods and declares its capabilities as **data**:

```ts
interface PlatformCapabilities {
  maxThreadDepth: number | null;  // 1 = flat (Instagram); null = unbounded (X)
  maxBodyLength: number;
  supportsWebhooks: boolean;      // false → poll
  mentionOnReparent: boolean;
}
```

Domain code branches on capabilities, never on `platform === 'instagram'`.
**Adding one is a class plus an entry in the `CLIENTS` array** — no service,
controller, entity or migration change, since `platform` is `text`, not an enum.

What that buys:

| | |
|---|---|
| **Depth clamping** | Instagram flattens a reply-to-a-reply, so we re-parent to the deepest allowed ancestor, `@mention` the real target, and return `wasReparented: true` — otherwise our mirror disagrees with the platform on the next sync. Length is checked *after* the mention, since it counts against the limit. |
| **Capability discovery** | `GET /v1/platforms` serves the same objects the backend enforces, so clients don't ship their own copy of the platform matrix and drift from it. |

---

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/posts/:postId/comments` | Thread view: top-level comments. Owns `?refresh` |
| `POST` | `/v1/posts/:postId/comments` | Comment on your own post → `202` |
| `GET` | `/v1/comments` | Search across posts: `?postId` `?parentCommentId` `?platform` `?since` `?until` `?unansweredOnly` |
| `GET` | `/v1/comments/:id` | One comment; the poll target for a queued reply |
| `GET` | `/v1/comments/:id/replies` | Direct replies |
| `GET` | `/v1/comments/:id/thread` | Whole subtree, any depth, in reading order |
| `POST` | `/v1/comments/:id/replies` | Reply → `202` (`200` on idempotent replay) |
| `GET` | `/v1/platforms` | Supported platforms + capabilities |

Every comment listing takes `?limit` `?cursor` `?order`.

| Rule | Why |
|---|---|
| Nested route **and** flat collection | Thread view vs. cross-cutting view. `?refresh` lives only on the nested one, where a single post bounds the sync a request can trigger. |
| Replies never inlined in a listing | One 400-reply thread would dwarf a 400-comment page. `replyCount` tells clients where to page. |
| Keyset pagination, never `OFFSET` | Lists are append-heavy and shift under the reader. |
| Cursors are ours, not the platform's | Opaque base64 over `(sortKey, id)`, so a platform changing its pagination can't invalidate cursors clients hold. |
| RFC 9457 `problem+json` | Stable `code` to branch on, separate from the HTTP status. |
| Platform failure → `502`/`504`, never `500` | The caller's request was fine; keeps 5xx alerting meaningful. |

---

## Data model

`social_accounts` → `posts` → `comments` → `comment_authors`, plus
`comment_sync_state`. Full DDL in [`src/database/migrations`](src/database/migrations).

| Choice | Why |
|---|---|
| One `comments` table for mirrored comments **and** outbound replies, split by `origin` | A pending reply must appear in its thread instantly; a separate outbox would make every read union two sources and re-derive ordering. Check constraints keep both shapes honest. |
| `parent_id` + `root_id` + `depth` + materialised `path` | `ORDER BY path` returns a conversation already assembled and `path LIKE 'x/%'` is one range scan — no recursive CTE per read. |
| Path segment = zero-padded `<epoch ms>-<short id>` | Makes lexicographic order *identical* to chronological reading order. |
| `sort_at` generated from `COALESCE(platform_created_at, created_at)` | One sort key everywhere, so a pending reply orders correctly and doesn't jump once delivery fills in the real timestamp. |
| Partial unique `(social_account_id, platform_comment_id)` | Re-polling a thread head is a no-op, not a duplicate. Threading columns are never updated on conflict: rewriting a `path` invalidates every descendant's. |
| Soft deletes | Comments vanish upstream constantly; hard deletes orphan replies and erase a conversation the customer may have acted on. |
| Partial indexes | The outbox index stays proportional to the queue, not to all comment history. |

A closure table would also work, but costs O(depth) rows per insert and syncing
is write-heavy.

---

## Tests

**25 unit tests, no database** — depth clamping and mentions, idempotent replay
vs. conflict, per-platform limits, retryable vs. terminal failures, sync
threading and re-sync id/path preservation, path ordering, cursors.

Stubs can't reach SQL or concurrency, so that was checked by hand against
Postgres 16: full flow over HTTP, claim queries under double-claim, query plans
at 50k rows. Four bugs surfaced **only** there:

- `UPDATE … RETURNING` returns `[rows, affectedCount]` in TypeORM
- the migration CLI never loaded `.env`, so it used the default database
- the cross-post query had no index — sequential scan plus sort
- the poller's "claim" was a plain `SELECT`, so every worker polled every post

That list is the argument for CI against a Postgres service container, which is
the next step and isn't here.

---

## AI usage

I used **Claude** and **ChatGPT**, for two things:

- **Setting up the template** — the NestJS/TypeORM scaffolding, config wiring and
  boilerplate around the parts that matter.
- **Discussing architecture-level decisions** — mirror vs. proxy, outbox vs.
  inline delivery, capability-driven adapters, how to represent threading. I used
  them to argue both sides of each before committing to one, which is also why
  the reasoning for each is written down above rather than left implicit.

---

## What I'd build next

Left out on purpose, in the order I'd pick them up.

| # | What | Why it's next | Shape |
|---|---|---|---|
| 1 | **CI on real Postgres** | Every bug under Tests needed a database to find; stubs reach none of them | One workflow, a service container, the demo flow |
| 2 | **Per-account rate-limit budget** | The mirror exists to protect this budget and nothing enforces it. The limit is per *account*; the unit of work is a *post* | Token bucket both workers check before calling out |
| 3 | **Bounded dispatch concurrency** | Delivery is sequential, so one slow platform call throttles the whole queue | Concurrency cap, plus a per-thread key for ordering |
| 4 | **Multi-tenant fairness** | Both workers claim in global due-time order, so one big workspace starves the rest | Per-workspace quota inside the claim query |
| 5 | **Webhook receivers** | The flag, the polling fallback and `CommentSyncService.ingest` already exist | Per-platform signature verification |
| 6 | **Per-account capabilities** | Static per adapter, while real platforms vary by API tier and scope — the model's ceiling | Resolve from `PlatformContext` instead of a field |
| 7 | **Delete/hide + reply audit** | Not in the brief, and cheap once the pattern exists | One capability flag, one adapter method |

**Not on the list: a broker.** Postgres as the queue is right at this scale, and
the swap sits behind one class if that changes.
