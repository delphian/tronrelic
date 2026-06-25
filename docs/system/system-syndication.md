# Syndication

The durable `publish` sink family of the [content router](./system-content-routing.md). Curation — and any future originator — commits approved publish legs here; this layer guarantees each leg is delivered with idempotent retry and dead-lettering instead of an in-process best-effort fan-out that loses effects on a crash. Lives in the [`syndication` module](../../src/backend/modules/syndication/README.md) and is published as the `'syndication'` service.

## Why This Matters

An external publish is a real side effect, and the obvious shape — a bare `Promise.allSettled` over the selected sinks inside the request path — is a **dual-write hazard**: a crash mid-fan-out loses the legs with no record to retry from, leaving the decision durable but the effect not. For a real external outlet (`trp-telegram-bot` ships one) that is a defect, not a placeholder. The same gap a curation `record-decision-then-callback` would carry.

Syndication closes it by making the *intent* durable — one outbox row per leg, committed in the same transaction as the decision — and the *delivery* durable and observable — a relay drains, retries, and dead-letters out of the request path. The honest delivery contract, and the rule every consumer must assume, is **at-least-once plus idempotency, which is effectively-once**. Exactly-once across external HTTP APIs is not on offer, and the design must not pretend otherwise.

## How It Works

The durable stack is four well-worn pieces — transactional outbox → async relay → idempotent receiver → retry/backoff/dead-letter — each closing a specific failure mode the best-effort path leaves open.

**Transactional outbox.** In the same transaction that records the originator's decision, syndication writes one outbox row per `(descriptor, destination)` leg. Decision and intent commit together or not at all, closing the gap the gate-then-callback leaves open. The descriptor is **frozen at enqueue**, so delivery survives a later edit to the source record.

**Async relay.** A scheduler job (`syndication:relay`) drains due rows out of band, resolves each leg's sink from the *live* router, calls `deliver`, and settles the row. The fan-out is now durable and observable, never a fire-and-forget in the request path. A sink registered or re-enabled after enqueue still delivers. Because the relay is an ordinary scheduler job, `ENABLE_SCHEDULER=false` is the global delivery kill-switch — enqueue still commits, legs simply wait.

**Idempotent receiver.** Each row carries a stable key derived from `(originId, sinkId)`, handed to the sink as the optional `IContentDeliveryContext` third argument of `deliver`. A sink whose wire protocol supports a client-supplied idempotency key uses it so a retried row cannot double-post; a sink whose protocol offers no such hook ignores it and the at-least-once guarantee stands. The platform never inspects the key — it only supplies it.

**Retry, then dead-letter.** A thrown delivery fails the row and reschedules it under capped-exponential backoff while its attempt budget remains; on exhaustion it dead-letters to an operator surface. A settled `IContentSinkRefusal` is terminal and **never retried** — a refusal is a "will not", distinct from a failure's retryable "could not". A failed leg neither blocks nor duplicates a delivered sibling leg.

### One approval is a saga, not an atomic commit

There is no two-phase commit across Twitter, Telegram, and Reddit, so the N legs of one approval are **independent at-least-once deliveries**, never an atomic saga. Partial success stands: a permanently-failed Reddit leg does not retract a delivered Twitter leg. "All-or-nothing across destinations" is available only as *compensation* (retract the legs that landed), and whether the product even wants that is a syndication-policy decision this layer does not make.

### Outcomes become eventual

Delivery is asynchronous, which reshapes what an originator may observe. The outbox is the single source of truth; an originator records each destination outcome as `pending` at decision time and overlays the live leg state on read rather than duplicating terminal state. An originator's commit-time callback (curation's `onApprove`) therefore sees `pending` intent, never where content landed — it is for the type's own bookkeeping, not for observing delivery.

## The Contract

| Member | Role |
|---|---|
| `ISyndicationService.enqueue(request)` | Commit one durable outbox row per leg. **Idempotent on `(originId, sinkId)`** — a re-enqueue is a no-op, so an originator may safely retry after a crash |
| `ISyndicationRequest` | `{ originId, originKind, descriptor, legs: [{ sinkId, dest? }] }`; `originId` is the idempotency base, `originKind` is audit/grouping metadata only and never feeds routing or authorization |
| `IContentDeliveryContext` | `{ idempotencyKey, attempt }` the relay hands each `deliver`; the receiver's hook for effectively-once |
| relay (`syndication:relay`) | Claims due legs by compare-and-swap, delivers via the live router, settles `delivered` / `refused` / `failed` / `dead`; one leg's fault never aborts the tick |
| dead-letter + `retry(legId)` | Terminal state after budget exhaustion; an operator requeues with a fresh budget |

The prescriptive **delivery guarantee**: at-least-once per leg, plus per-leg idempotency, equalling effectively-once only for a sink that honors the key; legs are independent with no cross-destination atomicity.

## Quick Reference

| Surface | Value |
|---|---|
| Service registry name | `'syndication'` → `ISyndicationService` |
| Owned collection | `module_syndication_outbox` |
| Scheduler job | `syndication:relay` (every minute); `ENABLE_SCHEDULER=false` is the delivery kill-switch |
| Operator REST | `GET /stats`, `GET /dead-letter`, `POST /dead-letter/:legId/retry` under `/api/admin/system/syndication` |
| Types | `@delphian/tronrelic-types` → `ISyndicationService`, `ISyndicationRequest`, `ISyndicationLeg`, `ISyndicationLegView`, `SyndicationLegStatus` |

Schema fields, the relay algorithm in detail, backoff curve, tuning constants, and the source map are the [Syndication Module README](../../src/backend/modules/syndication/README.md) — implementation detail of this contract.

## Invariants

1. Enqueue is idempotent on `(originId, sinkId)`; an originator may retry it freely.
2. The descriptor is frozen at enqueue; the relay never re-reads the origin.
3. A leg is claimed by exactly one relay tick (CAS); concurrent relays never double-claim.
4. `refused` is terminal and distinct from `failed` (retryable) — a refusal is never retried.
5. A leg dead-letters only after exhausting its budget; dead-letter is terminal until an operator `retry()`s it.
6. Delivery is at-least-once; only the sink's use of the idempotency key makes it effectively-once.
7. No cross-destination atomicity — legs are independent; partial success stands.

## Example

Curation acts as an **originator**, re-originating the approved descriptor into syndication on decision:

```typescript
// Inside the same transaction that records the approval, enqueue one durable
// leg per selected publish sink. Re-enqueue after a crash is a safe no-op.
await syndication.enqueue({
    originId: item.id, originKind: 'curation', descriptor: d,
    legs: bindings.map(b => ({ sinkId: b.sink.id, dest: b.dest }))
});
```

## Further Reading

- [system-content-routing.md](./system-content-routing.md) — the unifying router and sink-family model this durable family realizes; where syndication sits among the gate and delivery families
- [system-curation.md](./system-curation.md) — the gate-sink family that originates into syndication; the atomic decision gate the outbox commits against
- [Syndication Module README](../../src/backend/modules/syndication/README.md) — the implementation: outbox schema, relay algorithm, backoff curve, tuning constants, source map, operator REST surface
- [Curation Module README](../../src/backend/modules/curation/README.md) — the destination picker that selects the publish legs enqueued here
- [system-scheduler-operations.md](./system-scheduler-operations.md) — the `syndication:relay` job and the `ENABLE_SCHEDULER` kill-switch
