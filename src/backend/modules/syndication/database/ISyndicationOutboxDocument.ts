/**
 * @file ISyndicationOutboxDocument.ts
 *
 * The persisted shape of one syndication outbox leg — the transactional-outbox
 * row that makes durable multi-sink delivery possible. One row per
 * `(originId, sinkId)` destination, written when an originator enqueues and
 * drained by the relay until it reaches a terminal state. The row is the single
 * source of truth for that leg's delivery: a consumer (curation) overlays its own
 * audit from these rows rather than duplicating the state.
 *
 * The document is deliberately self-contained — it freezes the descriptor and the
 * destination config at enqueue time — so the relay can deliver it minutes or
 * retries later without re-reading the origin, and so the delivered content
 * survives a later edit of the source.
 *
 * @module modules/syndication/database
 */

import type { IContentDescriptor, SyndicationLegStatus } from '@/types';

/** Logical collection name for the syndication outbox (module-prefixed by convention). */
export const SYNDICATION_OUTBOX_COLLECTION = 'module_syndication_outbox';

/**
 * One durable delivery leg. `_id` is the leg id (a uuid). `idempotencyKey` is the
 * unique `(originId, sinkId)` derivation that makes enqueue idempotent and gives
 * the relay a stable key to hand a sink for receiver-side dedupe. `attempts` is
 * incremented at claim time, so it is the count of deliveries *attempted*, and the
 * leg dead-letters once it reaches `maxAttempts`.
 */
export interface ISyndicationOutboxDocument {
    /** Leg id (uuid); also the outbox row `_id`. */
    _id: string;

    /** Unique `${originId}::${sinkId}` key; the enqueue-idempotency and receiver-dedupe key. */
    idempotencyKey: string;

    /** Stable id of the originating record (e.g. a curation item id). */
    originId: string;

    /** What produced the request (e.g. `'curation'`); audit/grouping only. */
    originKind: string;

    /**
     * The owning content type id (e.g. the blog type). Frozen from the origin so
     * a delivery-success subscriber can identify the provider without re-reading
     * the source. With `ref`, the complete coordinate to load the full record.
     */
    typeId: string;

    /**
     * The opaque provider pointer the owning content type resolves back to its
     * own record (e.g. `{ postId: '...' }`). Frozen at enqueue, never interpreted
     * by syndication — forwarded verbatim to delivery-success subscribers.
     */
    ref: Record<string, unknown>;

    /** The content-router sink id this leg delivers to. */
    sinkId: string;

    /** The canonical IR frozen at enqueue time and delivered to the sink. */
    descriptor: IContentDescriptor;

    /** Admin-supplied per-destination config handed verbatim to the sink's `deliver`. */
    dest: Record<string, unknown>;

    /** Current lifecycle state. */
    status: SyndicationLegStatus;

    /** Deliveries attempted so far; incremented atomically at claim time. */
    attempts: number;

    /** Retry budget — the leg dead-letters when `attempts` reaches this. */
    maxAttempts: number;

    /** When a `pending`/`failed` leg becomes eligible for the relay to claim. */
    nextAttemptAt: Date;

    /**
     * Per-claim token written when the relay CAS-claims the leg into `delivering`.
     * Lets a crash-orphaned `delivering` row be told from a healthy in-flight one
     * by age, so stale claims can be reclaimed for retry.
     */
    claimToken?: string;

    /** Last failure message when the leg has errored; absent otherwise. */
    lastError?: string;

    /** Sink-supplied decline reason when `refused`; absent otherwise, never interpreted. */
    reason?: string;

    /** When the leg was enqueued. */
    createdAt: Date;

    /** When the leg last changed state. */
    updatedAt: Date;
}
