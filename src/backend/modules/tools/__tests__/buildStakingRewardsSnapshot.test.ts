/**
 * @fileoverview Tests for the staking rewards formula.
 *
 * The figures published on the calculator come only from this function, and
 * an error in it would show every visitor a wrong yearly reward with nothing
 * on the page to suggest it. The cases below check the formula against sums
 * worked out by hand, plus the ranking and cut-off rules around it.
 */

import { describe, it, expect } from 'vitest';
import {
    buildStakingRewardsSnapshot,
    BLOCK_PRODUCER_COUNT,
    REWARDED_REPRESENTATIVE_COUNT,
    type IStakingRewardsRepresentativeInput
} from '../services/buildStakingRewardsSnapshot.js';

/** Blocks in a 365-day year at a 3-second interval. */
const BLOCKS_PER_YEAR = 10_512_000;

/**
 * Build `count` representatives with descending votes, so the first in the
 * list is ranked first.
 *
 * @param count - How many to build.
 * @param votesOf - Votes for the representative at a zero-based position.
 * @returns The representatives, highest votes first.
 */
function representatives(count: number, votesOf: (index: number) => number): IStakingRewardsRepresentativeInput[] {
    return Array.from({ length: count }, (_, index) => ({
        address: `T${String(index).padStart(33, '0')}`,
        url: `https://sr-${index}.example`,
        votes: votesOf(index),
        commissionPercent: 0
    }));
}

describe('buildStakingRewardsSnapshot', () => {
    it('pays every top-127 representative the same vote reward per vote and adds the block reward only for the top 27', () => {
        // 127 representatives with 1,000,000 votes each: 127,000,000 votes in total.
        const snapshot = buildStakingRewardsSnapshot({
            fetchedAt: new Date('2026-11-22T00:00:00Z'),
            blockRewardSun: 8_000_000,
            voteRewardSun: 128_000_000,
            blockIntervalSeconds: 3,
            representatives: representatives(REWARDED_REPRESENTATIVE_COUNT, () => 1_000_000)
        });

        // Vote reward: 128 TRX x 10,512,000 blocks / 127,000,000 votes = 10.5946... TRX per vote, or 1059.46%.
        const expectedVotePercent = (128 * BLOCKS_PER_YEAR / 127_000_000) * 100;
        // Block reward: 8 TRX x 10,512,000 / 27 producers / 1,000,000 votes = 3.1147... TRX per vote.
        const expectedBlockPercent = (8 * BLOCKS_PER_YEAR / 27 / 1_000_000) * 100;

        const producer = snapshot.representatives[0];
        const standby = snapshot.representatives[BLOCK_PRODUCER_COUNT];

        expect(snapshot.blocksPerYear).toBe(BLOCKS_PER_YEAR);
        expect(snapshot.totalVotes).toBe(127_000_000);
        expect(producer.producesBlocks).toBe(true);
        expect(producer.voteRewardPercent).toBeCloseTo(expectedVotePercent, 3);
        expect(producer.blockRewardPercent).toBeCloseTo(expectedBlockPercent, 3);
        expect(producer.totalRewardPercent).toBeCloseTo(expectedVotePercent + expectedBlockPercent, 3);
        expect(standby.producesBlocks).toBe(false);
        expect(standby.voteRewardPercent).toBeCloseTo(expectedVotePercent, 3);
        expect(standby.blockRewardPercent).toBe(0);
    });

    it('takes the commission off both rewards', () => {
        const input = representatives(REWARDED_REPRESENTATIVE_COUNT, () => 1_000_000);
        input[0] = { ...input[0], commissionPercent: 20 };

        const snapshot = buildStakingRewardsSnapshot({
            fetchedAt: new Date('2026-11-22T00:00:00Z'),
            blockRewardSun: 8_000_000,
            voteRewardSun: 128_000_000,
            blockIntervalSeconds: 3,
            representatives: input
        });

        const withCommission = snapshot.representatives.find(item => item.commissionPercent === 20)!;
        const without = snapshot.representatives.find(item => item.commissionPercent === 0 && item.producesBlocks)!;

        expect(withCommission.totalRewardPercent).toBeCloseTo(without.totalRewardPercent * 0.8, 3);
    });

    it('ranks by votes, drops representatives with none, and keeps only the top 127', () => {
        const input = representatives(200, index => 1_000_000 + index);
        input.push({ address: 'TZERO', url: 'zero', votes: 0, commissionPercent: 0 });

        const snapshot = buildStakingRewardsSnapshot({
            fetchedAt: new Date('2026-11-22T00:00:00Z'),
            blockRewardSun: 8_000_000,
            voteRewardSun: 128_000_000,
            blockIntervalSeconds: 3,
            representatives: input
        });

        expect(snapshot.representatives).toHaveLength(REWARDED_REPRESENTATIVE_COUNT);
        expect(snapshot.representatives[0].votes).toBe(1_000_199);
        expect(snapshot.representatives[0].rank).toBe(1);
        expect(snapshot.representatives.some(item => item.address === 'TZERO')).toBe(false);
    });

    it('pays a producer with fewer votes a higher block reward per vote', () => {
        const snapshot = buildStakingRewardsSnapshot({
            fetchedAt: new Date('2026-11-22T00:00:00Z'),
            blockRewardSun: 8_000_000,
            voteRewardSun: 128_000_000,
            blockIntervalSeconds: 3,
            representatives: representatives(30, index => 10_000_000 - index * 100_000)
        });

        const first = snapshot.representatives[0];
        const last = snapshot.representatives[BLOCK_PRODUCER_COUNT - 1];

        expect(last.blockRewardPercent).toBeGreaterThan(first.blockRewardPercent);
    });

    it('refuses to compute with no votes at all or with a non-positive block interval', () => {
        const base = {
            fetchedAt: new Date('2026-11-22T00:00:00Z'),
            blockRewardSun: 8_000_000,
            voteRewardSun: 128_000_000
        };

        expect(() => buildStakingRewardsSnapshot({ ...base, blockIntervalSeconds: 3, representatives: representatives(3, () => 0) })).toThrow();
        expect(() => buildStakingRewardsSnapshot({ ...base, blockIntervalSeconds: 0, representatives: representatives(3, () => 1) })).toThrow();
    });
});
