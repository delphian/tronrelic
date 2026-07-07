/**
 * @fileoverview Payload for the `scheduler.legDelivered` observer hook.
 *
 * A syndication leg is one durable delivery of one approved content item to one
 * external sink. Successful delivery is a domain fact other components want to
 * react to — record an audit row, bump a per-sink success metric, kick a
 * downstream workflow — without the syndication relay learning about them. The
 * relay fires this observer seam once per leg the moment a sink reports success,
 * from inside the `syndication:relay` scheduler tick.
 *
 * The payload is built to be self-sufficient for a subscriber that wants to load
 * the full underlying content by hand. It carries the rendered `descriptor` that
 * was actually delivered (a faithful, decision-time snapshot), plus the provider
 * content coordinates — `typeId` names the owning content type and `ref` is the
 * opaque pointer that type resolves back to its own record (e.g. `{ postId }` for
 * the blog type). A subscriber that knows the provider can read `ref` to fetch
 * the live record; core never interprets `ref`'s shape.
 *
 * @module types/hooks/ISyndicationDeliveredContext
 */

import type { IContentDescriptor } from '../content/IContentDescriptor.js';

/**
 * Context handed to handlers of the `scheduler.legDelivered` hook — the sink and
 * content of one successfully delivered syndication leg.
 */
export interface ISyndicationDeliveredContext {
    /** The content-router sink id the leg was delivered to. */
    sinkId: string;

    /**
     * Human-readable sink label, best-effort. Present only while the sink is
     * still registered at delivery time; absent otherwise. Use `sinkId` as the
     * stable key.
     */
    sinkLabel?: string;

    /**
     * The owning content type id (e.g. the blog type). With `ref`, the complete
     * coordinate a subscriber needs to resolve the provider's own record.
     */
    typeId: string;

    /**
     * The opaque provider pointer, resolved verbatim by the owning content type
     * back to its record (e.g. `{ postId: '...' }`). Core never interprets it.
     */
    ref: Record<string, unknown>;

    /**
     * The rendered content descriptor that was delivered to the sink — the
     * decision-time snapshot frozen into the outbox leg, not a live re-render.
     */
    descriptor: IContentDescriptor;

    /** The delivered leg id (the outbox row id); uniquely identifies this delivery. */
    legId: string;

    /** Stable id of the originating record (e.g. the curation item id). */
    originId: string;

    /** What produced the originating request (e.g. `'curation'`); audit/grouping only. */
    originKind: string;

    /** The stable `(originId, sinkId)` idempotency key handed to the sink. */
    idempotencyKey: string;

    /** Delivery attempt number that succeeded (1 on first-try success). */
    attempt: number;
}
