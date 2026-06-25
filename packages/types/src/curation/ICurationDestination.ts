/**
 * @file ICurationDestination.ts
 *
 * The contracts for choosing and recording a held item's *destinations* when it
 * is approved. They let the human review gate double as the place an operator
 * selects where approved content goes — the design's "mandated subset", made
 * interactive and per-item instead of standing policy. Curation surfaces the
 * publish-kind sinks the content router admits for the item's type
 * ({@link ICurationEligibleDestination}); the curator selects one or more
 * ({@link ICurationDestinationSelection}); on approval each selection is
 * delivered and its result recorded ({@link ICurationDestinationOutcome}).
 *
 * These are curation-owned envelope concerns, not router concerns: the router
 * computes *which* sinks are eligible; curation owns *which* the human picked
 * and *what happened* when it delivered. Keeping them here keeps the router's
 * narrow waist (`IContentSink`) from accreting per-pipeline selection state.
 *
 * @see ../../../../docs/system/system-content-routing.md — the potential-versus-
 *   mandated policy layering and the gate-as-selector direction.
 */

import type { IContentClassification } from '../content/IContentClassification.js';

/**
 * A publish sink the content router admits for a held item's content type,
 * offered to the curator as a selectable destination. Carries only what the
 * picker needs to render and pre-select — never the sink's `deliver` callback,
 * which the curator never touches.
 */
export interface ICurationEligibleDestination {
    /** The router sink id the curator selects, e.g. `core:internal-publish`. */
    sinkId: string;

    /** Human-readable sink name; the picker falls back to `sinkId` when absent. */
    label?: string;

    /** The exposure delivering to this sink causes, shown so the curator sees how far the content will travel. */
    reach: IContentClassification;

    /**
     * Whether standing admin policy pre-selects this sink for the item's type.
     * The picker renders it checked by default; the curator confirms or overrides
     * per item, so policy data and human judgment compose rather than compete.
     */
    defaultSelected: boolean;
}

/**
 * One destination the curator selected, passed to `approve()`. The `dest` bag is
 * the admin-supplied per-destination config the sink's `deliver` reads (a
 * handle, a chat id); the internal publish sink needs none, so it is optional.
 */
export interface ICurationDestinationSelection {
    /** The router sink id to deliver to; must be one of the item's eligible publish sinks. */
    sinkId: string;

    /** Optional per-destination config handed verbatim to the sink's `deliver`. */
    dest?: Record<string, unknown>;
}

/**
 * Delivery state of one selected destination. `pending` is written in the same
 * atomic transition as the approval decision (so the intent commits with the
 * decision, never lost to a crash before delivery); delivery then advances each
 * to a terminal state. `delivered` and `failed` are the two-way split of an
 * attempt — succeeded or errored; `refused` is the sink's deliberate decline of
 * content it matched but will not render, distinct from a failure because it is
 * settled rather than retryable. This mirrors curation's existing record-
 * decision-then-act posture: the decision and the *intent* are durable, the
 * per-leg effect is best-effort and observable in the audit rather than
 * transactional.
 */
export type CurationDestinationStatus = 'pending' | 'delivered' | 'failed' | 'refused';

/**
 * The recorded result of delivering one selected destination, persisted on the
 * item and surfaced in history so an operator sees exactly where an approved
 * item landed and where it did not.
 */
export interface ICurationDestinationOutcome {
    /** The router sink id this outcome is for. */
    sinkId: string;

    /** Delivery state — pending until delivery runs, then delivered, failed, or refused. */
    status: CurationDestinationStatus;

    /** Failure message when `status` is `failed`; absent otherwise. */
    error?: string;

    /** Sink-supplied explanation when `status` is `refused`; absent otherwise, never interpreted by curation. */
    reason?: string;
}
