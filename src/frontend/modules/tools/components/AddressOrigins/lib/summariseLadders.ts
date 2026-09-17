/**
 * @fileoverview Headline figures for the strip above the traces.
 */

import type { IOriginLadder } from '../../../types';
import type { ISharedParty } from './collectSharedParties';

/**
 * The four figures the result strip reports.
 */
export interface ILadderSummary {
    /** How many wallets the current trace covered. */
    wallets: number;

    /** Total rungs resolved across every wallet. */
    rungs: number;

    /** Accounts reached by more than one of those wallets. */
    shared: number;

    /** Steps in the longest single chain, so a reader can see how far it got. */
    deepest: number;
}

/**
 * Reduce the current traces to the figures shown above them.
 *
 * Why a strip at all: a ten-wallet trace produces a wall of rungs, and the first
 * questions a reader has — did every wallet resolve, did anything turn out to be
 * shared, how deep did this get — are answerable in four numbers that would
 * otherwise take a scroll and a count.
 *
 * @param ladders - Every trace currently on screen.
 * @param sharedParties - The shared accounts already derived from those traces,
 *        passed in rather than recomputed so the strip and the panel beside it
 *        can never disagree about what counts as shared.
 * @returns The four figures, all zero before the first trace runs.
 */
export function summariseLadders(ladders: IOriginLadder[], sharedParties: ISharedParty[]): ILadderSummary {
    let rungs = 0;
    let deepest = 0;

    for (const ladder of ladders) {
        rungs += ladder.hops.length;
        deepest = Math.max(deepest, ladder.hops.length);
    }

    return {
        wallets: ladders.length,
        rungs,
        shared: sharedParties.length,
        deepest
    };
}
