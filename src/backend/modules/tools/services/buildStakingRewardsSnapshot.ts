/**
 * @fileoverview The arithmetic behind the staking rewards calculator.
 *
 * Kept apart from the service that fetches its inputs so the reward formula
 * can be tested with plain numbers and no TronGrid or database.
 *
 * How TRON pays voters, with every rate read from the chain at refresh time:
 * - Every block pays a vote reward (`getWitness127PayPerBlock`, 128 TRX in
 *   November 2026) to the top 127 representatives in proportion to their
 *   votes, so one vote earns the same share whichever of them it backs.
 * - Every block also pays a block reward (`getWitnessPayPerBlock`, 8 TRX in
 *   November 2026) to the one of the top 27 that produced it. The 27 take
 *   turns, so each produces about a 27th of all blocks, and its block reward
 *   is split among its own voters only.
 * - A representative keeps its commission (TRON's "brokerage") from both and
 *   passes the rest to its voters in proportion to their votes.
 * - One staked TRX gives one vote, so a reward per vote per year is a yearly
 *   rate on the TRX staked.
 */

import type { ISuperRepresentativeReward, IStakingRewardsSnapshot } from '@/types';

/**
 * Representatives that share each block's vote reward. Fixed by the TRON
 * protocol rather than set by a chain parameter.
 */
export const REWARDED_REPRESENTATIVE_COUNT = 127;

/**
 * Representatives that produce blocks and so also earn the block reward.
 * Fixed by the TRON protocol rather than set by a chain parameter.
 */
export const BLOCK_PRODUCER_COUNT = 27;

/** Seconds in a 365-day year, used to turn the block interval into blocks per year. */
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/** SUN in one TRX. */
const SUN_PER_TRX = 1_000_000;

/**
 * One representative as the service hands it over: already converted to a
 * Base58 address and with its commission read.
 */
export interface IStakingRewardsRepresentativeInput {
    /** Base58 address. */
    address: string;
    /** Registered URL or name. */
    url: string;
    /** Votes held. */
    votes: number;
    /** Share of rewards the representative keeps, from 0 to 100. */
    commissionPercent: number;
}

/**
 * Everything the formula needs, read from the chain by the caller.
 */
export interface IStakingRewardsInput {
    /** When the inputs were read; stored on the snapshot as its timestamp. */
    fetchedAt: Date;
    /** SUN paid to the producer of each block. */
    blockRewardSun: number;
    /** SUN shared across the top 127 for each block. */
    voteRewardSun: number;
    /** Seconds between blocks. */
    blockIntervalSeconds: number;
    /** Representatives in any order; only the top 127 by votes are used. */
    representatives: IStakingRewardsRepresentativeInput[];
}

/**
 * Round a percentage for display while keeping enough digits for a small
 * reward on a large stake to come out right.
 */
function roundPercent(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

/**
 * Work out every top-127 representative's yearly voter reward from the chain's
 * reward rates and vote counts.
 *
 * Representatives with no votes are dropped before ranking, because they share
 * nothing. The block reward assumes each of the top 27 produces an equal share
 * of blocks; a producer that misses blocks pays slightly less than shown.
 *
 * @param input - Reward rates, block interval, and representatives with their commissions.
 * @returns The snapshot the calculator reads, with representatives in rank order.
 * @throws Error when the block interval is not positive or no representative holds votes.
 */
export function buildStakingRewardsSnapshot(input: IStakingRewardsInput): IStakingRewardsSnapshot {
    if (!(input.blockIntervalSeconds > 0)) {
        throw new Error(`Block interval must be positive, got ${input.blockIntervalSeconds}`);
    }

    const ranked = input.representatives
        .filter(representative => representative.votes > 0)
        .sort((a, b) => b.votes - a.votes)
        .slice(0, REWARDED_REPRESENTATIVE_COUNT);

    if (ranked.length === 0) {
        throw new Error('No Super Representative holds any votes, so no reward can be calculated');
    }

    const blocksPerYear = SECONDS_PER_YEAR / input.blockIntervalSeconds;
    const blockRewardTrx = input.blockRewardSun / SUN_PER_TRX;
    const voteRewardTrx = input.voteRewardSun / SUN_PER_TRX;
    const totalVotes = ranked.reduce((sum, representative) => sum + representative.votes, 0);

    // The same for every one of the 127, before commission.
    const voteRewardPerVote = (voteRewardTrx * blocksPerYear) / totalVotes;
    // Each producer's yearly block reward, before commission and before
    // dividing by that producer's own votes.
    const blockRewardPerProducer = (blockRewardTrx * blocksPerYear) / BLOCK_PRODUCER_COUNT;

    const representatives: ISuperRepresentativeReward[] = ranked.map((representative, index) => {
        const voterShare = 1 - representative.commissionPercent / 100;
        const producesBlocks = index < BLOCK_PRODUCER_COUNT;
        const voteRewardPercent = voteRewardPerVote * voterShare * 100;
        const blockRewardPercent = producesBlocks
            ? (blockRewardPerProducer / representative.votes) * voterShare * 100
            : 0;

        return {
            address: representative.address,
            url: representative.url,
            rank: index + 1,
            votes: representative.votes,
            producesBlocks,
            commissionPercent: representative.commissionPercent,
            voteRewardPercent: roundPercent(voteRewardPercent),
            blockRewardPercent: roundPercent(blockRewardPercent),
            totalRewardPercent: roundPercent(voteRewardPercent + blockRewardPercent)
        };
    });

    return {
        fetchedAt: input.fetchedAt.toISOString(),
        blockRewardTrx,
        voteRewardTrx,
        blocksPerYear,
        totalVotes,
        representatives
    };
}
