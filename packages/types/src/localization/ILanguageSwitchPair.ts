/**
 * @fileoverview Language switches counted for one direction of travel.
 */

/**
 * How many times visitors moved from one language to another within the
 * stats window. `en → zh` and `zh → en` are separate pairs, because a visitor
 * leaving a translation says something different from one arriving at it.
 */
export interface ILanguageSwitchPair {
    /** Language the visitors were reading. */
    from: string;

    /** Language they clicked. */
    to: string;

    /** Switches recorded in the window. */
    count: number;
}
