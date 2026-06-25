# Syndication Module

Durable `publish`-family delivery for the content router. Curation (and any future originator) commits approved publish legs here; this module guarantees each leg is delivered with idempotent retry and dead-lettering, instead of an in-process best-effort fan-out that loses effects on a crash. It is the durable answer the [content-routing design](../../../../docs/system/system-content-routing.md) names: transactional outbox → async relay → idempotent receiver → retry/backoff → dead-letter.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `syndication` |
| Module class | `src/backend/modules/syndication/SyndicationModule.ts` |
| Service registry name | `'syndication'` → `ISyndicationService` (from `@/types`) |
| Admin API base | `/api/admin/system/syndication` (admin-gated at mount) |
| Owned collection | `module_syndication_outbox` |
| Scheduler job | `syndication:relay` — `*/1 * * * *` (every minute) |
| Types package | `@delphian/tronrelic-types` → `ISyndicationService`, `ISyndicationRequest`, `ISyndicationLeg`, `ISyndicationLegView`, `SyndicationLegStatus`, `SYNDICATION_SERVICE` |
| Bootstrap order | Inits after curation (resolved lazily, so order is non-binding); runs after curation and **before** scheduler (so the relay job registers before the scheduler ticks) |
| Frontend | None yet — operator surface is REST-only |

## Why Durable, Not Best-Effort

An external publish is a real side effect. The prior shipped path delivered curation's selected publish legs inline, best-effort: a crash mid-fan-out lost the legs with no record to retry from — a **dual-write hazard** (decision durable, effect not). For a real external outlet (`trp-telegram-bot` ships one), that is a defect, not a placeholder. This module closes it by making the *intent* durable (one outbox row per leg, committed before delivery) and the *delivery* durable and observable (a relay drains, retries, and dead-letters out of the request path).

The honest contract — and the rule every consumer **must** assume — is **at-least-once plus idempotency, which is effectively-once**. There is no two-phase commit across external HTTP APIs, so the N legs of one approval are **independent at-least-once deliveries**, never an atomic saga. A retried leg can re-hit a destination; the per-leg idempotency key is what lets a sink that can dedupe avoid a double-post. "All-or-nothing across destinations" is not on offer.

## Source Map

| Path | Responsibility |
|------|----------------|
| `SyndicationModule.ts` | Two-phase lifecycle; resolves the content router, constructs the service, registers the relay job, mounts the operator router, publishes `'syndication'` |
| `services/syndication-service.ts` | The engine: enqueue, the relay (`runRelayOnce`), claim/deliver/settle, dead-letter, read projections |
| `services/syndication-backoff.ts` | Pure capped-exponential backoff (`backoffMs`) |
| `database/ISyndicationOutboxDocument.ts` | Outbox row shape + collection name |
| `api/syndication.controller.ts` / `syndication.router.ts` | Operator REST surface (stats, dead-letter, retry) |

## Service Contract — `ISyndicationService`

| Method | Purpose |
|--------|---------|
| `enqueue(request)` | Commit one outbox row per leg. **Idempotent on `(originId, sinkId)`** — a re-enqueue is a no-op, so an originator may safely retry after a crash. Returns the full leg set. |
| `getLegs(originId)` | Live leg state for one origin — the overlay source a consumer reads. |
| `getLegsForOrigins(originIds)` | Batched `getLegs`, keyed by `originId`. |
| `listDeadLettered(limit?)` | The permanently-failed legs awaiting operator attention. |
| `retry(legId)` | Requeue a dead-lettered leg with a fresh budget. No-op (false) for any non-dead leg. |
| `getStats()` | Per-status leg counts. |

`ISyndicationRequest` = `{ originId, originKind, descriptor, legs: [{ sinkId, dest? }] }`. `originId` is the stable identity of the originating record (a curation item id) and **is** the idempotency base; `originKind` is audit/grouping metadata only and must never feed routing or authorization.

## Outbox Schema — `module_syndication_outbox`

| Field | Notes |
|-------|-------|
| `_id` | Leg id (uuid). |
| `idempotencyKey` | `${originId}::${sinkId}`. **Unique index** — the enqueue-dedupe and receiver-dedupe key. |
| `originId` / `originKind` | Originating record id / producer label. |
| `sinkId` | Content-router sink the leg delivers to. |
| `descriptor` | The canonical IR, **frozen at enqueue** so delivery survives a later source edit. |
| `dest` | Per-destination config handed verbatim to `deliver`. |
| `status` | `pending \| delivering \| delivered \| refused \| failed \| dead`. |
| `attempts` / `maxAttempts` | Attempts made / retry budget. |
| `nextAttemptAt` | When a `pending`/`failed` leg becomes due. |
| `claimToken` | Per-claim token; lets a crash-orphaned `delivering` row be told from a live one by age. |
| `lastError` / `reason` | Failure message / sink refusal reason (verbatim, never interpreted). |

**Indexes:** `{ idempotencyKey }` unique, `{ status, nextAttemptAt }` (due scan), `{ originId }` (overlay). Created in `init()`; no migration (new collection — Mongoose/`createIndex` owns initial schema).

## How the Relay Must Work

`runRelayOnce()` (the `syndication:relay` job body) runs each tick:

1. **Reclaim stale claims.** Any leg `delivering` longer than `CLAIM_STALE_MS` (5 min) is reset to `failed`, due now — it was orphaned by a crash mid-attempt. This is the at-least-once leg: the external call may or may not have landed, so it is retried, and the sink's idempotency key prevents a double-effect.
2. **Find due legs.** `status ∈ {pending, failed}` and `nextAttemptAt ≤ now`, oldest-due first, bounded by `RELAY_BATCH_LIMIT` (25).
3. **Claim — CAS.** Each leg is claimed with an `updateMany` filtered on its current `(status, attempts)`, setting `delivering` and the next `attempts`. The filter is the concurrency guard: two overlapping ticks cannot both win — exactly one sees a modified count of 1. Atomicity comes from the CAS filter, not an `$inc`.
4. **Deliver.** Resolve the sink from the **live** router by id and call `deliver(descriptor, dest, { idempotencyKey, attempt })`. A sink registered (or re-enabled) after enqueue still delivers.
5. **Settle, one of:**
   - resolves `void` → `delivered` (terminal).
   - resolves `IContentSinkRefusal` → `refused` (terminal — a settled "will not", reason recorded, **never retried**).
   - throws → `failed` with `nextAttemptAt = now + backoffMs(attempt)` while budget remains, else `dead` (dead-letter, terminal).
   - sink not currently registered → treated as a **retryable** failure (a disabled plugin may return), counting toward the budget.

Each leg's claim-and-deliver is isolated, so one fault never aborts the tick. The relay is a normal scheduler job: `ENABLE_SCHEDULER=false` is the **global delivery kill-switch** — enqueue and the operator surface still work; committed legs simply wait until the relay runs again.

**Backoff curve.** `backoffMs(attempt) = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS · 2^(attempt-1))` = `min(60m, 1m · 2^(attempt-1))` → 1, 2, 4, 8, 16, 32, 60, 60 minutes. Default budget `DEFAULT_MAX_ATTEMPTS = 8`.

## Idempotency — the Receiver's Obligation

The relay hands every `deliver` an `IContentDeliveryContext` (`{ idempotencyKey, attempt }`) as its optional third argument. A sink whose wire protocol supports a client-supplied idempotency key (or an upsert) **must** use it so a retried row cannot double-post. A sink whose protocol offers no such hook (Telegram `sendMessage`) ignores it, and the at-least-once guarantee stands — a retry may duplicate. The platform never inspects the key; it only supplies it. The third argument is optional, so every existing two-argument sink remains valid unchanged.

## Curation Integration

On approving a `publishesToDestinations` item, `CurationService.decide()` enqueues the selected publish legs into `'syndication'` (resolved lazily, so a boot without the module degrades to the legacy best-effort path). Consequences a consumer **must** account for:

- **Outcomes become eventual.** The item's destination outcomes are recorded `pending` at decision time and advanced by the relay out-of-band. The outbox is the single source of truth; curation overlays live leg state onto its outcomes on read (`get`, `listHistory`) — it does not duplicate terminal state.
- **`onApprove` sees `pending`, not terminal results.** External delivery is now asynchronous and must not block the decision. A type's `onApprove` is for its own bookkeeping, not for observing where content landed.
- **Status mapping.** Curation's four-state outcome collapses syndication's six: `delivered`→`delivered`, `refused`→`refused`, `dead`→`failed`, and `pending`/`delivering`/(retryable)`failed`→`pending` (still in flight).

## Invariants

1. Enqueue is idempotent on `(originId, sinkId)`; an originator may retry it freely.
2. The descriptor is frozen at enqueue; the relay never re-reads the origin.
3. A leg is claimed by exactly one tick (CAS); concurrent relays never double-claim.
4. `refused` is terminal and distinct from `failed` (retryable) — a refusal is never retried.
5. A leg dead-letters only after exhausting `maxAttempts`; dead-letter is terminal until an operator `retry()`s it.
6. Delivery is at-least-once; only the sink's use of the idempotency key makes it effectively-once.
7. No cross-destination atomicity — legs are independent; partial success stands.

## Tuning Constants

In `services/syndication-service.ts`, overridable per-instance via `ISyndicationServiceOptions` (used by tests; not env vars, to avoid the prod env-wiring surface): `DEFAULT_MAX_ATTEMPTS` (8), `RELAY_BATCH_LIMIT` (25), `CLAIM_STALE_MS` (5 min). Backoff base/cap in `syndication-backoff.ts`.

## Operator REST Surface

All under `/api/admin/system/syndication` (`requireAdmin`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/stats` | Per-status leg counts. |
| GET | `/dead-letter?limit=` | Dead-lettered legs (newest first, clamped). |
| POST | `/dead-letter/:legId/retry` | Requeue one dead-lettered leg; 404 if absent or not dead. |

## Not Yet Built

- **Saga / compensation.** Independent at-least-once legs only; retracting landed legs when another fails permanently is a deliberate non-goal here (a syndication-policy decision, not the router's).
- **Authorization gate.** The classification gate's `policy.permits` is still an allow-all stub platform-wide — a separate authorization pass, not this module's concern.
- **Live admin UI / WebSocket push.** The operator surface is REST-only; the curation overlay refreshes on read, not via a live signal.

## Further Reading

- [system-content-routing.md](../../../../docs/system/system-content-routing.md) — the durable-delivery design and the sink-family model this realizes.
- [system-curation.md](../../../../docs/system/system-curation.md) — the gate-sink family that originates into syndication.
- [Curation Module README](../curation/README.md) — the destination picker that selects the publish legs enqueued here.
- [system-database.md](../../../../docs/system/system-database.md) — the `IDatabaseService` surface the engine is built on.
