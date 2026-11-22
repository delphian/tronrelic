/**
 * @fileoverview One Super Representative's voting reward, as the staking
 * rewards calculator shows it.
 *
 * TRON pays two kinds of reward to the accounts that vote for a Super
 * Representative (SR), after the SR keeps its commission:
 *
 * - A vote reward, paid every block and shared across the top 127 SRs by
 *   vote count. Each vote earns the same amount whichever of those SRs it
 *   goes to.
 * - A block reward, paid to the SR that produced the block. Only the top 27
 *   SRs produce blocks, and an SR with fewer votes shares its block reward
 *   among fewer voters, so each vote earns more there.
 */

/**
 * The reward a voter earns through one Super Representative, as a yearly
 * percentage of the TRX they vote with (one staked TRX is one vote).
 */
export interface ISuperRepresentativeReward {
    /** The SR's Base58 address, starting with T. */
    address: string;

    /** The URL or name the SR registered, which is the only label TRON stores for it. */
    url: string;

    /** Position by vote count, starting at 1. */
    rank: number;

    /** Votes the SR holds. */
    votes: number;

    /** True for the top 27, which produce blocks and so also pay a block reward. */
    producesBlocks: boolean;

    /** The share of rewards the SR keeps, from 0 to 100. Voters receive the rest. */
    commissionPercent: number;

    /** Yearly percentage earned from the vote reward, after commission. */
    voteRewardPercent: number;

    /** Yearly percentage earned from the block reward, after commission; 0 outside the top 27. */
    blockRewardPercent: number;

    /** The two rewards added together: what a voter earns per year per TRX voted, as a percentage. */
    totalRewardPercent: number;
}
