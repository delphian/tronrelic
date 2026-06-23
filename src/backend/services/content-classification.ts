/**
 * @fileoverview Pure mechanics of the governed classification vocabulary.
 *
 * One place that knows how the `{ egress, audience }` dimensions rank and what
 * counts as a valid value, shared by the two collaborators that must agree on
 * it: the router (which refuses a sink whose `reach` is malformed, at
 * registration) and the classification gate (which compares `reach` against a
 * content ceiling). Keeping the rank order and the membership check here — never
 * duplicated at the two call sites — is what makes "registration refuses an
 * unknown dimension" and "reach ≤ classification" provably consistent.
 *
 * The level order is taken from the tuples in `@/types`, so the type and the
 * runtime rank can never drift. Rank is the tuple index, ascending from least to
 * most exposed; containment is rank-≤ on every dimension.
 *
 * @see ../../../docs/system/system-content-routing.md — classification as a
 *   ceiling and the `reach ≤ classification` direction.
 * @module backend/services/content-classification
 */

import { CONTENT_EGRESS_LEVELS, CONTENT_AUDIENCE_LEVELS, CONTENT_DESCRIPTOR_FEATURES } from '@/types';
import type { IContentClassification, ContentDescriptorFeature } from '@/types';

/** The dimensions a classification declares, in the order errors report them. */
const CLASSIFICATION_DIMENSIONS = ['egress', 'audience'] as const;

/**
 * Rank an egress level by its position in the ordered vocabulary. Returns -1
 * for an unknown level so a containment check against an unknown ceiling fails
 * closed (admits nothing) rather than throwing inside the routing hot path.
 *
 * @param level - A candidate egress value.
 * @returns The ascending-exposure rank, or -1 when the value is not a known level.
 */
function egressRank(level: string): number {
    return (CONTENT_EGRESS_LEVELS as ReadonlyArray<string>).indexOf(level);
}

/**
 * Rank an audience level by its position in the ordered vocabulary. Same
 * fail-closed contract as {@link egressRank}.
 *
 * @param level - A candidate audience value.
 * @returns The ascending-breadth rank, or -1 when the value is not a known level.
 */
function audienceRank(level: string): number {
    return (CONTENT_AUDIENCE_LEVELS as ReadonlyArray<string>).indexOf(level);
}

/**
 * Whether a sink's `reach` stays within a content's classification ceiling on
 * every dimension — the load-bearing containment relation `reach ≤ ceiling`.
 * The label caps where content may go; it never grants exposure. An unknown
 * ceiling level ranks -1, so any concrete reach is *not* within it: a malformed
 * ceiling admits nothing rather than leaking content past an unrecognized cap.
 *
 * @param reach - The exposure a sink causes.
 * @param ceiling - The content's exposure ceiling.
 * @returns True when reach is contained by the ceiling on both dimensions.
 */
export function isWithinCeiling(reach: IContentClassification, ceiling: IContentClassification): boolean {
    const egressOk = egressRank(reach.egress) <= egressRank(ceiling.egress) && egressRank(ceiling.egress) >= 0;
    const audienceOk = audienceRank(reach.audience) <= audienceRank(ceiling.audience) && audienceRank(ceiling.audience) >= 0;

    return egressOk && audienceOk;
}

/**
 * Validate a sink's `reach` against the governed vocabulary, throwing on the
 * first problem so registration fails fast — the same stance the hook registry
 * takes when it refuses a descriptor it did not mint. Catches three malformations
 * the `IContentClassification` type cannot prevent at runtime (a plugin built
 * against a stale vocabulary, a JS caller, a hand-built object): an unknown
 * dimension key, a missing dimension, or an out-of-vocabulary level.
 *
 * @param reach - The classification a sink declared as its reach.
 * @throws Error naming the offending dimension or level.
 */
export function assertValidReach(reach: IContentClassification): void {
    if (reach === null || typeof reach !== 'object') {
        throw new Error('Sink reach must be a { egress, audience } classification object.');
    }

    for (const key of Object.keys(reach)) {
        if (!(CLASSIFICATION_DIMENSIONS as ReadonlyArray<string>).includes(key)) {
            throw new Error(
                `Unknown classification dimension '${key}' in sink reach. ` +
                `Known dimensions: ${CLASSIFICATION_DIMENSIONS.join(', ')}.`
            );
        }
    }

    if (egressRank(reach.egress) < 0) {
        throw new Error(
            `Unknown egress level '${String(reach.egress)}' in sink reach. ` +
            `Known levels: ${CONTENT_EGRESS_LEVELS.join(', ')}.`
        );
    }

    if (audienceRank(reach.audience) < 0) {
        throw new Error(
            `Unknown audience level '${String(reach.audience)}' in sink reach. ` +
            `Known levels: ${CONTENT_AUDIENCE_LEVELS.join(', ')}.`
        );
    }

    return;
}

/**
 * Validate a sink's `accepts` against the known descriptor features, throwing on
 * the first unknown entry. `accepts` is the sole routing predicate, so an
 * unrecognized feature is a registration error, not a silently-never-matching
 * sink that an operator would struggle to diagnose.
 *
 * @param accepts - The descriptor features a sink declared it can render.
 * @throws Error naming the offending feature when one is not a known feature.
 */
export function assertValidAccepts(accepts: ReadonlyArray<ContentDescriptorFeature>): void {
    if (!Array.isArray(accepts)) {
        throw new Error('Sink accepts must be an array of descriptor features.');
    }

    for (const feature of accepts) {
        if (!(CONTENT_DESCRIPTOR_FEATURES as ReadonlyArray<string>).includes(feature)) {
            throw new Error(
                `Unknown descriptor feature '${String(feature)}' in sink accepts. ` +
                `Known features: ${CONTENT_DESCRIPTOR_FEATURES.join(', ')}.`
            );
        }
    }

    return;
}
