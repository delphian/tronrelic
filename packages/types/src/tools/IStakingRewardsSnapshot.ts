/**
 * @fileoverview The stored inputs and results behind the staking rewards
 * calculator.
 *
 * Working out each Super Representative's reward needs one TronGrid call per
 * representative, so the tools module computes the whole table on a schedule
 * and stores it. The calculator page, its embeddable widget, and the public
 * endpoint all read this one stored snapshot.
 */

import type { ISuperRepresentativeReward } from './ISuperRepresentativeReward.js';

/**
 * Every Super Representative's voter reward at one moment, with the chain
 * figures it was worked out from, so a reader can check the arithmetic.
 */
export interface IStakingRewardsSnapshot {
    /** When the snapshot was computed, as an ISO 8601 string. */
    fetchedAt: string;

    /** TRX paid to the producing representative for each block (the chain's `getWitnessPayPerBlock`). */
    blockRewardTrx: number;

    /** TRX shared across the top 127 representatives for each block (the chain's `getWitness127PayPerBlock`). */
    voteRewardTrx: number;

    /** Blocks the chain produces in a year at its block interval. */
    blocksPerYear: number;

    /** Votes held by the top 127 representatives together, which the vote reward is divided by. */
    totalVotes: number;

    /** The top 127 representatives by votes, in rank order. */
    representatives: ISuperRepresentativeReward[];
}
