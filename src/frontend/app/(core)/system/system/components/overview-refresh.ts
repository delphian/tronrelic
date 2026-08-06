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
 * What the readout remembers about one console across its poll cycles.
 *
 * Keeping only the latest outcome cannot answer the operator's question, because
 * the cycle that just failed carries no useful time: overwriting the console's
 * last good stamp with a failure erases the only evidence of how stale the
 * screen is, and if every console fails the readout falls silent exactly when it
 * is being relied on. So the last success and the current health are tracked
 * separately — the stamp freezes, the failure is announced, and both persist
 * while it lasts.
 */
export interface IRefreshFreshness {
    /**
     * When its most recent successful cycle finished, or null if none has yet.
     *
     * Deliberately survives later failures untouched: this is the age of the
     * data still on screen, not the age of the last attempt.
     */
    lastSuccessAt: string | null;

    /** Whether its most recently completed cycle failed. */
    failing: boolean;
}

/** Freshness of a console that has not completed a cycle yet. */
export const INITIAL_FRESHNESS: IRefreshFreshness = { lastSuccessAt: null, failing: false };

/**
 * Fold one poll outcome into what is already known about a console.
 *
 * Lives beside the contract so both sections' outcomes are absorbed by the same
 * rule, and so that rule sits in one place: a success moves the stamp forward, a
 * failure leaves the stamp exactly where it was and only raises the flag.
 *
 * @param previous - The console's freshness before this cycle reported, needed
 * because a failed cycle can only be described in terms of the last good one.
 * @param report - The outcome the console just stamped.
 * @returns The console's freshness after absorbing the outcome.
 */
export function foldRefresh(
    previous: IRefreshFreshness,
    report: IRefreshReport
): IRefreshFreshness {
    const next: IRefreshFreshness = report.ok
        ? { lastSuccessAt: report.at, failing: false }
        : { lastSuccessAt: previous.lastSuccessAt, failing: true };

    return next;
}

/**
 * One console the readout speaks for.
 */
export interface IRefreshSource extends IRefreshFreshness {
    /** How the console is named if the readout has to report it failing. */
    label: string;
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
