# Blotato — Multi-Platform Comment System

Retrieve comments on published posts and reply to them, across social platforms,
behind one REST API.

NestJS · TypeScript · Postgres (TypeORM, hand-written migrations)

---

## Run it

```bash
npm install
docker compose up -d                 # Postgres on :55432
cp .env.example .env
npm run migration:run
npm run demo                         # seeds a post + thread on an in-memory platform
```

`npm run demo` prints ready-to-paste `curl` commands. Swagger is at `/docs`.

```bash
npm test          # 17 unit tests, no database required
npm run typecheck
```

The demo runs against a `fake` platform adapter that implements the same
interface as the real ones, so the whole system — sync, threading, pagination,
the reply outbox and its dispatcher — is exercisable without credentials.

---

## The two decisions everything else follows from

### 1. Reads are served from our own mirror, not proxied to the platform

`GET /posts/:id/comments` reads Postgres. A background poller (and webhooks,
where a platform has them) keeps the mirror fresh.

Proxying looks simpler and breaks quickly:

- **Rate limits are per connected account**, and *publishing* needs that budget.
  One customer refreshing a busy post should not cost them a scheduled post.
- **Every platform paginates differently** — X uses opaque tokens, Instagram uses
  Graph cursors, LinkedIn uses offsets. A single API cursor across them is not
  possible if the cursor has to be the platform's.
- **Every read inherits platform latency and downtime.** Mirrored, a read is one
  indexed query.
- Sorting, filtering and "show me every unanswered comment across all my posts"
  are only possible over local data.

The cost is staleness, so staleness is **reported rather than hidden**:

```json
"meta": { "syncedAt": "2026-08-11T13:37:07Z", "stale": false }
```

`?refresh=true` forces a live pull first. If that pull fails, the request still
returns cached comments with `meta.syncError` set — a slightly stale answer beats
a 502, provided the caller is told.

### 2. Replies are a transactional outbox, not a synchronous platform call

`POST /comments/:id/replies` writes a row with `delivery_status = 'pending'` and
returns **202** immediately. A dispatcher delivers it out of band.

Calling the platform inline means a 30-second X timeout becomes a 30-second HTTP
request, a 429 becomes the user's problem to retry by hand, and — worst — a
network failure *after* the platform accepted the write becomes a duplicate
public comment.

The reply row **is** the queue entry and **is** the comment. So:

- enqueueing shares a transaction with the write; a reply cannot be accepted but
  not queued,
- the reply appears in its thread instantly, in the right position, which is what
  a user expects after hitting send,
- `Idempotency-Key` is enforced by a unique index, so a retried POST returns the
  original reply instead of double-posting.

The dispatcher claims work with `FOR UPDATE SKIP LOCKED`, which scales
horizontally with no broker and no lock service:

```sql
UPDATE comments SET delivery_status = 'sending',
                    delivery_attempts = delivery_attempts + 1,
                    next_attempt_at = now() + make_interval(secs => $2)
 WHERE id IN (SELECT id FROM comments
               WHERE delivery_status IN ('pending','sending')
                 AND next_attempt_at <= now()
               ORDER BY next_attempt_at
               FOR UPDATE SKIP LOCKED LIMIT $1)
RETURNING id;
```

Claiming also pushes `next_attempt_at` forward by a visibility timeout, so a
worker that dies mid-delivery releases its rows automatically instead of
stranding them in `sending`.

Retries use exponential backoff **with full jitter** — an outage fails every
pending reply at once, and without jitter they would all retry in the same
instant. Non-retryable failures (revoked token, rejected body) fail immediately
rather than burning the attempt budget, because they need a human, not time.

---

## Supporting many platforms

An adapter implements two methods, and declares its capabilities as **data**:

```ts
interface PlatformCommentClient {
  readonly platform: string;
  readonly capabilities: PlatformCapabilities;
  fetchComments(ctx, params): Promise<FetchCommentsPage>;
  publishReply(ctx, params): Promise<PublishReplyResult>;
}

interface PlatformCapabilities {
  maxThreadDepth: number;    // 1 = flat replies (Instagram, TikTok, YouTube)
  maxBodyLength: number;
  supportsWebhooks: boolean; // false → poll
  mentionOnReparent: boolean;
}
```

Domain code branches on capabilities, never on `platform === 'instagram'`.
**Adding a platform is one class plus one line in `PlatformsModule`** — no
service, controller, entity or migration changes.

Two things this bought:

**Depth clamping.** Instagram flattens a reply-to-a-reply onto the top-level
thread. If we stored the requested parent, our mirror would disagree with the
platform on the very next sync. Instead the reply is re-parented to the deepest
allowed ancestor, `@mentions` the person actually being answered (so the thread
still reads correctly), and the response says so:

```json
{ "parentId": "<root, not the requested comment>", "wasReparented": true,
  "body": "@omar Writeup goes out Friday!" }
```

The length check runs *after* the mention is prepended — it counts against the
platform's limit, and discovering that at delivery time is a failure the user
can neither see nor fix.

**Capability discovery.** `GET /v1/platforms` serves the same objects the backend
enforces, so clients render correct character counters and nesting rules instead
of shipping their own copy of the platform matrix and drifting from it.

`platform` is stored as `text`, not a Postgres enum, and typed as `string`, not a
union — **onboarding a platform must never require a migration.**

---

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/posts/:postId/comments` | Top-level comments. `?limit`, `?cursor`, `?order`, `?refresh` |
| `POST` | `/v1/posts/:postId/comments` | Comment on your own post → `202` |
| `GET` | `/v1/comments/:id` | One comment; also the poll target for a queued reply |
| `GET` | `/v1/comments/:id/replies` | Direct replies |
| `GET` | `/v1/comments/:id/thread` | Whole subtree, any depth, in reading order |
| `POST` | `/v1/comments/:id/replies` | Reply → `202` (`200` on idempotent replay) |
| `GET` | `/v1/platforms` | Supported platforms + capabilities |

Comments are nested under posts because a comment is meaningless without one; an
individual comment is then addressable at the top level once you have its id.

**Replies are not inlined into the listing.** A post with one 400-reply thread
would otherwise return a wildly different payload than one with 400 top-level
comments. Each comment carries `replyCount`, and the client pages into whichever
thread it needs — or fetches the whole subtree in one call via `/thread`.

**Pagination is keyset, never `OFFSET`.** Comment lists are append-heavy and
mutate under the reader; `OFFSET` degrades on deep pages and silently skips or
repeats rows when new comments land mid-scroll. Cursors are opaque base64 over
`(sortKey, id)` — ours, not the platform's, so a platform changing its pagination
cannot invalidate cursors our clients already hold.

**Errors are RFC 9457 `application/problem+json`** with a stable `code` clients
branch on, separate from the HTTP status. A platform failure surfaces as `502`
(or `504` on timeout), never `500` — the caller's request was fine, the upstream
was not, and that distinction keeps 5xx alerting meaningful.

```json
{ "title": "IdempotencyConflictException", "status": 409,
  "code": "idempotency_conflict",
  "detail": "Idempotency key \"k1\" was already used with a different body.",
  "instance": "/v1/comments/…/replies", "idempotencyKey": "k1" }
```

---

## Data model

`social_accounts` → `posts` → `comments` → `comment_authors`, plus
`comment_sync_state`. Full DDL: [`src/database/migrations`](src/database/migrations).

**One `comments` table holds both mirrored comments and outbound replies**,
distinguished by `origin`. An undelivered reply still has to appear in its
thread, in position, immediately — a separate outbox table would force every read
path to union two sources and re-derive ordering. Check constraints keep the two
shapes honest:

```sql
CONSTRAINT ck_comments_outbound_has_status
  CHECK ((origin = 'blotato') = (delivery_status IS NOT NULL))
```

**Threading is `parent_id` + `root_id` + `depth` + a materialised `path`.**
`parent_id` alone needs a recursive CTE on every thread read. A path segment is
`<zero-padded epoch ms>-<short id>`, so lexicographic path order *is*
chronological reading order — `ORDER BY path` returns a whole conversation
already assembled, and `path LIKE '<ancestor>/%'` selects a subtree as one index
range scan. A closure table would also work but costs O(depth) extra rows per
insert, and syncing is write-heavy.

**`sort_at` is a generated column**, `COALESCE(platform_created_at, created_at)`.
One sort key for every listing, so a pending reply orders correctly against
mirrored comments and does not jump position once delivery fills in the real
timestamp. Computed by Postgres, so it cannot drift from its inputs.

**Identity is `(social_account_id, platform_comment_id)`**, a partial unique
index. Re-polling the head of a thread replays pages constantly; `ON CONFLICT`
makes that a no-op instead of a duplicate. Threading columns are deliberately
never updated on conflict — rewriting a `path` would invalidate every
descendant's. Verified: syncing the same post three times leaves the row counts
unchanged, and a reply we published reconciles onto our own row rather than
appearing twice.

Indexes are partial wherever the query is (`WHERE deleted_at IS NULL`,
`WHERE delivery_status IN ('pending','sending')`) so the outbox index stays
proportional to the queue, not to all comment history.

**Deletes are soft.** Comments vanish upstream constantly — authors delete them,
platforms moderate them — and hard-deleting would orphan replies and destroy the
record of a conversation the customer may have acted on.

**Polling is adaptive.** Comment activity decays sharply with post age, so the
interval scales with it (1 min under an hour old → 6 h after a week), ×10 for
webhook platforms where polling is only a reconciliation net. Polling cost then
tracks *active* posts rather than every post ever published.

---

## Assumptions

Left unspecified by the brief; each is isolated behind a seam:

1. **Auth exists.** `X-Workspace-Id` stands in for real authentication
   (`WorkspaceId` decorator). What is *not* stubbed: every service method takes
   `workspaceId` explicitly and every query filters on it, so replacing the
   decorator changes where the id comes from, never whether it is applied. A
   post in another workspace returns `404`, not `403` — `403` would confirm the
   id exists.
2. **OAuth token storage exists.** `TokenVaultService` is the seam to it. Rows
   store a `credential_ref`, never a token, and tokens are fetched per call so a
   refresh is picked up by the next attempt.
3. **Posts and social accounts already exist**; they are modelled here only to
   the depth comments need.
4. **Comments are only for published posts** — there is no thread before
   publication. Enforced by a check constraint and a `409`.
5. **Platform counters are authoritative.** `likeCount`/`replyCount` are
   platform-reported and may exceed what we mirrored; clients use them to decide
   whether more exists.
6. **Only the connected account's own posts.** Monitoring third-party posts is a
   different product with different permissions.

---

## Deliberately not built

Scope discipline matters more than surface area, so these are called out rather
than half-built:

- **Webhook ingestion endpoints.** The capability flag and the polling fallback
  are in place; the receiver is per-platform signature verification work.
- **Deleting/hiding comments.** Not in the brief. It would be another capability
  flag and one adapter method.
- **A broker (BullMQ/SQS).** Postgres-as-queue is correct at this scale and
  strictly safer at the transactional boundary. The swap is behind one class.
- **Per-account rate-limit budgeting** across sync and publish. The adaptive
  poller and `Retry-After` handling are the first half; a shared token bucket is
  the second.
- **Reply history/audit** beyond `delivery_attempts` and `last_error`.

---

## Tests

17 unit tests over the logic that actually carries risk — depth clamping and
mention rewriting, idempotent replay vs. conflict, per-platform length limits,
retryable vs. terminal delivery failures, path ordering, cursor round-trips.
They run against stubs, so `npm test` needs no database.

Beyond that, the migration was applied to a real Postgres 16 and the full flow
driven end to end over HTTP: sync → list → paginate → reply → re-parent →
idempotent replay → dispatcher delivery → re-sync without duplication. Two bugs
surfaced only there and are fixed: TypeORM returns `[rows, affectedCount]` from
`UPDATE … RETURNING`, and `.returning('*')` yields snake_cased raw rows rather
than entities.

---

## AI usage

I used Claude (Claude Code) throughout, the way I'd use a fast pair: I made the
architectural calls — mirror-vs-proxy, outbox-vs-inline, capability-driven
adapters, the threading representation — and used it to draft implementations
against them, then reviewed and cut hard.

Two passes were specifically about *removing* AI output. The first dropped a
third platform adapter, a `DELETE` endpoint, a redundant sync route, unused sync
columns and a hand-rolled row mapper. The second stripped explanatory comments
down to the ones that answer a genuine "why?", moving the reasoning here instead.

I verified everything I kept: it typechecks, the tests pass, the migration runs
on real Postgres, and the flow above was driven over HTTP. The two bugs noted in
Tests were caught that way rather than taken on faith.
