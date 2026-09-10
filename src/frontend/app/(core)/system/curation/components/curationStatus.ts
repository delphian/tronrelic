/**
 * @fileoverview Labels and badge tones for the two status vocabularies the
 * curation page shows: an item's decision (approved or rejected) and each
 * publish destination's delivery outcome. The History table and the decision
 * record panel both render these, so they read them from one place.
 */

import type { ICurationSinkOutcome } from '../../../../../modules/curation';

/** The Badge tones these statuses map onto. */
type StatusTone = 'success' | 'danger' | 'warning' | 'neutral';

/** A destination's delivery state, as recorded on the decided item. */
type OutcomeStatus = ICurationSinkOutcome['status'];

/**
 * Delivered succeeds, failed alarms, refused warns (the destination declined on
 * purpose, which is settled rather than an error to retry), and pending stays
 * neutral because delivery has not finished yet.
 */
const OUTCOME_TONES: Record<OutcomeStatus, StatusTone> = {
    delivered: 'success',
    failed: 'danger',
    refused: 'warning',
    pending: 'neutral'
};

/** Sentence-case labels for each delivery state. */
const OUTCOME_LABELS: Record<OutcomeStatus, string> = {
    delivered: 'Delivered',
    failed: 'Failed',
    refused: 'Refused',
    pending: 'Pending'
};

/**
 * Pick the badge tone for a destination's delivery state, so an operator can
 * see where approved content landed without reading every label.
 *
 * @param status - The recorded delivery state.
 * @returns The Badge tone for that state.
 */
export function outcomeTone(status: OutcomeStatus): StatusTone {
    return OUTCOME_TONES[status] ?? 'neutral';
}

/**
 * Name a destination's delivery state in sentence case for display.
 *
 * @param status - The recorded delivery state.
 * @returns The display label, or the raw value for a state added later.
 */
export function outcomeLabel(status: OutcomeStatus): string {
    return OUTCOME_LABELS[status] ?? status;
}

/**
 * Pick the badge tone for an item's decision. Anything other than the two
 * known decisions stays neutral rather than guessing.
 *
 * @param status - The item's status word, e.g. `approved`.
 * @returns The Badge tone for that decision.
 */
export function decisionTone(status: string): StatusTone {
    let tone: StatusTone = 'neutral';
    if (status === 'approved') {
        tone = 'success';
    } else if (status === 'rejected') {
        tone = 'danger';
    }
    return tone;
}

/**
 * Name an item's decision in sentence case for display.
 *
 * @param status - The item's status word, e.g. `approved`.
 * @returns The capitalised label, or `Unknown` when no status is recorded.
 */
export function decisionLabel(status: string): string {
    return status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : 'Unknown';
}
