/**
 * @file ISyndicationService.ts
 *
 * The contract for the syndication module — the platform's durable `publish`
 * delivery family. Where curation is the gate sink family and notifications the
 * delivery sink family, syndication owns the hard part of *external* publishing:
 * fanning one approved content descriptor to N outlets where each leg can fail
 * independently, and guaranteeing each leg is delivered without the request-path
 * best-effort `Promise.allSettled` that loses effects on a crash.
 *
 * The mechanism is the transactional-outbox / async-relay / idempotent-receiver
 * stack. An originator (curation today) calls {@link ISyndicationService.enqueue}
 * with one {@link ISyndicationLeg} per destination; each becomes a durable outbox
 * row keyed by a stable idempotency key. A background relay drains the rows,
 * invokes each sink's `deliver`, and advances the row to a terminal state,
 * retrying failures with backoff and dead-lettering on exhaustion. The honest
 * delivery contract is **at-least-once plus idempotency, which is effectively-
 * once**; there is no two-phase commit across external APIs, so the N legs of one
 * approval are independent at-least-once deliveries, never an atomic saga.
 *
 * @see ../../../../docs/system/system-content-routing.md — the syndication
 *   durable-delivery design and the at-least-once contract.
 * @see ../../../../src/backend/modules/syndication/README.md — the prescriptive
 *   module reference: outbox schema, relay loop, backoff curve, dead-letter.
 */

import type { IContentDescriptor } from '../content/IContentDescriptor.js';

/** Service-registry name the syndication service is published under. */
export const SYNDICATION_SERVICE = 'syndication';

/**
 * The lifecycle states one outbox leg moves through. `pending` is the freshly
 * enqueued intent; `delivering` is a leg the relay has atomically claimed for an
 * in-flight attempt; `delivered` and `refused` are the two terminal *success-
 * shaped* states (delivered = the sink rendered it, refused = the sink
 * deliberately declined content it matched but will not render — settled, never
 * retried); `failed` is a *retryable* error with a future `nextAttemptAt`; `dead`
 * is the terminal dead-letter state after the retry budget is exhausted. Governed
 * like the rest of the vocabulary so a row can never carry an unknown status.
 */
export const SYNDICATION_LEG_STATUSES = [
    'pending',
    'delivering',
    'delivered',
    'refused',
    'failed',
    'dead'
] as const;

/** One leg lifecycle state; see {@link SYNDICATION_LEG_STATUSES}. */
export type SyndicationLegStatus = typeof SYNDICATION_LEG_STATUSES[number];

/**
 * One destination of a syndication request: the router sink to deliver to and
 * the admin-supplied per-destination config the sink's `deliver` reads (a handle,
 * a chat id). `dest` is optional because some sinks (the internal publish log)
 * need none.
 */
export interface ISyndicationLeg {
    /** The content-router sink id this leg delivers to. */
    sinkId: string;

    /** Optional per-destination config handed verbatim to the sink's `deliver`. */
    dest?: Record<string, unknown>;
}

/**
 * A request to durably syndicate one content descriptor to a set of destinations.
 * `originId` is the stable identity of the originating record (a curation item
 * id) and is the idempotency base: re-enqueuing the same `(originId, sinkId)` is
 * a no-op, so a crash-and-retry of the enqueue call never double-creates a leg.
 * `descriptor` is frozen into each row so the delivered content survives a later
 * edit of the source. `originKind` is audit/grouping metadata only — never a
 * routing or authorization input.
 */
export interface ISyndicationRequest {
    /** Stable id of the originating record; the per-leg idempotency base. */
    originId: string;

    /** What produced this request (e.g. `'curation'`); audit/grouping only. */
    originKind: string;

    /**
     * The owning content type id (e.g. the blog type). Frozen into every leg's
     * row alongside `ref` so a delivery-success subscriber can identify the
     * provider and load the full underlying record by hand.
     */
    typeId: string;

    /**
     * The opaque provider pointer the owning content type resolves back to its
     * own record (e.g. `{ postId: '...' }`). Frozen into every leg's row; never
     * interpreted by syndication.
     */
    ref: Record<string, unknown>;

    /** The canonical IR frozen into every leg's outbox row. */
    descriptor: IContentDescriptor;

    /** One leg per destination to deliver to. */
    legs: ISyndicationLeg[];
}

/**
 * The result of an {@link ISyndicationService.enqueue}: how many legs are now
 * durably queued and their ids. A leg that already existed (idempotent re-
 * enqueue) is counted and its existing id returned, so the caller always learns
 * the full leg set regardless of duplication.
 */
export interface ISyndicationEnqueueResult {
    /** Number of legs durably present after the call (new + already-existing). */
    enqueued: number;

    /** The leg ids, one per requested destination. */
    legIds: string[];
}

/**
 * The read projection of one outbox leg, for cross-pipeline overlay (curation
 * reading where an approved item's destinations stand) and the admin operator
 * surface. Dates are ISO strings so the shape crosses the wire unchanged.
 */
export interface ISyndicationLegView {
    /** The leg id (the outbox row id). */
    legId: string;

    /** Originating record id this leg belongs to. */
    originId: string;

    /** What produced the originating request. */
    originKind: string;

    /** The content-router sink this leg delivers to. */
    sinkId: string;

    /** Current lifecycle state. */
    status: SyndicationLegStatus;

    /** Attempts made so far (0 before the first claim). */
    attempts: number;

    /** The retry budget; the leg dead-letters once `attempts` reaches it. */
    maxAttempts: number;

    /** When the relay will next attempt a `pending`/`failed` leg (ISO). */
    nextAttemptAt?: string;

    /** Last failure message when the leg has errored; absent otherwise. */
    lastError?: string;

    /** Sink-supplied decline reason when `refused`; absent otherwise, never interpreted. */
    reason?: string;

    /** The stable `(originId, sinkId)` idempotency key. */
    idempotencyKey: string;

    /** When the leg was enqueued (ISO). */
    createdAt: string;

    /** When the leg last changed state (ISO). */
    updatedAt: string;
}

/**
 * Per-status leg counts for the operator dashboard.
 */
export interface ISyndicationStats {
    pending: number;
    delivering: number;
    delivered: number;
    refused: number;
    failed: number;
    dead: number;
}

/**
 * The durable publish-delivery service, published on the service registry as
 * `'syndication'`. An originator enqueues legs; the relay (a scheduler job) drains
 * and delivers them; consumers read leg state for their own audit overlay; an
 * operator inspects and retries dead-lettered legs.
 */
export interface ISyndicationService {
    /**
     * Durably enqueue one leg per destination. Idempotent on `(originId, sinkId)`:
     * a re-enqueued leg is left as-is, so the originating record may safely retry
     * the call. Returns the full leg set (new and pre-existing).
     *
     * @param request - The descriptor, origin identity, and destination legs.
     * @returns The count and ids of the durably-queued legs.
     */
    enqueue(request: ISyndicationRequest): Promise<ISyndicationEnqueueResult>;

    /**
     * The current state of every leg for one originating record — the data a
     * consumer (curation) overlays onto its own per-destination audit so it shows
     * live delivery state rather than a frozen snapshot.
     *
     * @param originId - The originating record id.
     * @returns The leg views, newest first.
     */
    getLegs(originId: string): Promise<ISyndicationLegView[]>;

    /**
     * Batched {@link getLegs} for a list view: the legs for many originating
     * records in one call, keyed by `originId`. Origins with no legs are absent
     * from the result.
     *
     * @param originIds - The originating record ids to look up.
     * @returns A map of `originId` to its leg views.
     */
    getLegsForOrigins(originIds: string[]): Promise<Record<string, ISyndicationLegView[]>>;

    /**
     * The legs that exhausted their retry budget and dead-lettered — the operator
     * surface for permanent failures awaiting attention.
     *
     * @param limit - Maximum legs to return (newest first).
     * @returns The dead-lettered leg views.
     */
    listDeadLettered(limit?: number): Promise<ISyndicationLegView[]>;

    /**
     * Return a dead-lettered leg to the queue with a fresh retry budget — the
     * operator's manual recovery after fixing the cause of a permanent failure.
     * A no-op (returns false) if the leg is not dead-lettered.
     *
     * @param legId - The leg to retry.
     * @returns True when a dead-lettered leg was requeued.
     */
    retry(legId: string): Promise<boolean>;

    /**
     * Per-status leg counts for the operator dashboard.
     *
     * @returns The current counts across all lifecycle states.
     */
    getStats(): Promise<ISyndicationStats>;
}
