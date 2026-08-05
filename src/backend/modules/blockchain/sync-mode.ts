/**
 * @fileoverview Which pacing mode block sync should run in.
 *
 * Sync either paces blocks to TRON's ~3-second cadence (caught up, so the live
 * feed reads smoothly) or runs flat out to close a gap (behind). Deciding that
 * on a single lag boundary made the syncer flap: a lag hovering on the
 * threshold flipped mode almost every tick, which stuttered the frontend feed
 * and buried genuine transitions in log noise.
 *
 * The decision therefore uses two thresholds with a dead band between them, and
 * lives here as a pure function — like `transaction-parse.ts`, it is behavior
 * worth pinning with tests rather than burying inside the sync loop's I/O.
 */

/**
 * The lag boundaries that separate the two pacing modes.
 *
 * They are a pair, not one number written twice: `entryBlocks` must stay
 * strictly above `resumeBlocks` or the band collapses and the flapping returns.
 * Equal values are not a crash — the decision simply degrades to a single
 * boundary — so the invariant is stated rather than enforced.
 */
export interface ISyncModeThresholds {
    /** Lag at or below which sync resumes the live 3-second throttle. */
    resumeBlocks: number;
    /** Lag at or above which sync drops the throttle and catches up flat out. */
    entryBlocks: number;
}

/**
 * Decide whether sync should treat itself as caught up to the chain head.
 *
 * Inside the dead band the previous mode wins, so a lag oscillating between the
 * two thresholds changes nothing. With no previous mode — first tick after a
 * restart, or after the scheduler lock moves to another instance — a lag inside
 * the band resolves to "behind", which is the safe direction: an unthrottled
 * tick costs only speed and drives lag straight down to where the throttle
 * resumes, whereas guessing "caught up" would pace a genuinely lagging syncer at
 * three seconds per block and let it fall further behind.
 *
 * @param blocksBehind - How far the local cursor trails the network head.
 * @param previousCaughtUp - The mode from the last tick; `null` when unknown.
 * @param thresholds - The dead band's two edges.
 * @returns True to throttle to live cadence, false to run flat out.
 */
export function resolveCaughtUpMode(
    blocksBehind: number,
    previousCaughtUp: boolean | null,
    thresholds: ISyncModeThresholds
): boolean {
    let caughtUp: boolean;

    if (blocksBehind >= thresholds.entryBlocks) {
        caughtUp = false;
    } else if (blocksBehind <= thresholds.resumeBlocks) {
        caughtUp = true;
    } else {
        caughtUp = previousCaughtUp ?? false;
    }

    return caughtUp;
}
