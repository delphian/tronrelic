/**
 * @fileoverview Turns a stake and a reward rate into TRX earned per period.
 *
 * The backend publishes each Super Representative's yearly reward rate, and the
 * calculator applies it to whatever amount the visitor types. Doing that in the
 * browser keeps the calculator instant and sends no request per keystroke.
 */

/**
 * TRX a stake earns over a year, a month, and a day.
 */
export interface IStakingRewardEstimate {
    /** TRX earned in a year. */
    perYear: number;
    /** TRX earned in an average month (a twelfth of a year). */
    perMonth: number;
    /** TRX earned in a day (a 365th of a year). */
    perDay: number;
}

/**
 * Apply a yearly reward rate to a stake.
 *
 * Simple interest on purpose: TRON does not add rewards to the stake on its
 * own. A voter claims them, at most once a day, and only re-staking them
 * compounds, so a compounded figure would promise growth nobody gets unless
 * they act.
 *
 * @param trx - The TRX staked and voted with; anything not a positive number earns nothing.
 * @param ratePercent - The representative's yearly reward rate, as a percentage.
 * @returns TRX earned per year, month, and day.
 */
export function estimateStakingReward(trx: number, ratePercent: number): IStakingRewardEstimate {
    const stake = Number.isFinite(trx) && trx > 0 ? trx : 0;
    const perYear = (stake * ratePercent) / 100;

    return {
        perYear,
        perMonth: perYear / 12,
        perDay: perYear / 365
    };
}
