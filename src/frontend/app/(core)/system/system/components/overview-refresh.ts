/**
 * @fileoverview Shared refresh contract for the Overview tab's consoles.
 *
 * The tab shows one staleness readout for two independently polling sections,
 * which only works if all three agree on the cadence and on how an outcome is
 * reported. The interval used to be a private constant in each section and again
 * in the readout, held in step by a comment — so changing one section's poll rate
 * silently made the label wrong.
 *
 * The reporting contract exists for a sharper reason: a readout that stamps a
 * fresh time on a timer of its own claims the screen is current at exactly the
 * moment it is not. When a console's polls start failing — a 429 from the split
 * admin rate-limit buckets, an expired admin session, a backend that stopped
 * answering — the operator needs the readout to stop advancing and say so. So
 * each section reports the outcome of every cycle it completes, and the readout
 * renders only what it was told.
 */

/** Poll cadence shared by the Overview tab's section consoles, in milliseconds. */
export const REFRESH_INTERVAL_MS = 10000;

/**
 * The outcome of one console's most recently completed poll cycle.
 */
export interface IRefreshReport {
    /** When the cycle finished, as an ISO string for `<ClientTime>`. */
    at: string;

    /**
     * Whether the cycle produced usable data.
     *
     * True mirrors the section clearing its error alert, false mirrors it
     * raising one, so the readout and the card below it never disagree about
     * whether the screen is live.
     */
    ok: boolean;
}

/**
 * One console the readout speaks for.
 */
export interface IRefreshSource {
    /** How the console is named if the readout has to report it failing. */
    label: string;

    /** Its latest outcome, or null before its first cycle completes. */
    report: IRefreshReport | null;
}

/**
 * Stamp a poll outcome with the time it completed.
 *
 * Kept here so both sections stamp identically, and so the time is taken when
 * the fetch settles rather than when the readout happens to re-render — the gap
 * between those two is the whole bug this contract closes.
 *
 * @param ok - Whether the cycle produced usable data.
 * @returns The report to hand upward.
 */
export function stampRefresh(ok: boolean): IRefreshReport {
    return { at: new Date().toISOString(), ok };
}
