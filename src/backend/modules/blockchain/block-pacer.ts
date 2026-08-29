/**
 * @fileoverview The clock that spaces `block:new` broadcasts evenly.
 *
 * TRON produces one block every three seconds, and the live feed reads well
 * only when broadcasts arrive on that same cadence. The obvious way to do that
 * — time each block and sleep whatever is left of three seconds — quietly
 * fails, because it resets its stopwatch on every block. A block that takes 3.4
 * seconds emits 400ms late and the next one still gets a fresh three-second
 * budget, so the average interval is never below three seconds and is above it
 * whenever anything runs slow. Against a chain producing at exactly three
 * seconds, that surplus is lag the syncer can never give back. It accumulates
 * until the syncer decides it is behind, drops pacing altogether, dumps the
 * backlog in a few seconds, and starts over — the sawtooth users see as a feed
 * that alternates between stalling and spurting.
 *
 * The fix is to pace against a deadline that carries forward rather than a
 * per-block stopwatch. A block that overruns shortens the next wait instead of
 * pushing its overrun into permanent lag, which holds the long-run average at
 * exactly one block interval. How much debt may carry forward is capped,
 * because a deadline left sitting minutes in the past after an outage would
 * release every held-back block at once.
 *
 * The arithmetic lives here as pure functions, like `sync-mode.ts`, so the
 * behaviour can be pinned by tests instead of being buried in the sync loop's
 * I/O.
 *
 * @module backend/modules/blockchain/block-pacer
 */

/** Everything the pacer needs to decide when the next broadcast is due. */
export interface IEmitPacingInput {
    /** Current wall-clock time in milliseconds, normally `Date.now()`. */
    now: number;
    /**
     * When the next broadcast was already due, carried over from the previous
     * call. Zero or negative means the pacer has not run yet in this process,
     * which starts the clock at `now` rather than inventing a backlog.
     */
    nextEmitAt: number;
    /** Target spacing between broadcasts, which is one TRON block time. */
    intervalMs: number;
    /**
     * How many blocks' worth of missed deadline the pacer may work off at full
     * speed. This bounds how long a burst can last after a stall.
     */
    maxDebtBlocks: number;
}

/** The pacer's answer: how long to wait, and the deadline to carry forward. */
export interface IEmitPacing {
    /** Milliseconds to sleep before broadcasting. Zero when already due. */
    delayMs: number;
    /** The value to pass back as `nextEmitAt` on the following call. */
    nextEmitAt: number;
}

/**
 * Work out how long to hold a block before broadcasting it.
 *
 * Callers keep the returned `nextEmitAt` and hand it straight back on the next
 * call. That carried-forward deadline is the whole mechanism, because it is
 * what lets a fast block absorb the overrun of a slow one instead of every
 * block starting its own three-second budget from zero. The deadline is floored
 * at `maxDebtBlocks` intervals in the past so a long stall cannot bank
 * unlimited catch-up and release it as a burst.
 *
 * @param input - Current time, the deadline carried over from the previous
 *                block, the target spacing, and the debt cap. Time is supplied
 *                by the caller rather than read here so tests can drive the
 *                clock directly.
 * @returns The wait to apply before broadcasting, and the deadline to keep for
 *          the next block, so the caller never does the arithmetic itself and
 *          cannot get the carry-forward wrong.
 */
export function resolveEmitPacing(input: IEmitPacingInput): IEmitPacing {
    const { now, nextEmitAt, intervalMs, maxDebtBlocks } = input;

    // A non-positive carried deadline means this is the first block this
    // process has paced. Starting from `now` broadcasts it immediately and
    // begins the cadence there, whereas treating zero as a real deadline would
    // read as an enormous backlog and fire the debt cap on a healthy start.
    const carried = nextEmitAt > 0 ? nextEmitAt : now;

    const debtFloorMs = Math.max(0, maxDebtBlocks) * intervalMs;
    const deadline = Math.max(carried, now - debtFloorMs);

    const result: IEmitPacing = {
        delayMs: Math.max(0, deadline - now),
        // Advance from the deadline rather than from `now`. Advancing from
        // `now` would hand every late block a full fresh interval, which is
        // exactly the drift this pacer exists to remove.
        nextEmitAt: deadline + intervalMs
    };

    return result;
}

/**
 * Express a block's age as a number of blocks, so the decision to pace a block
 * can be made from the block itself.
 *
 * The alternative is comparing the sync cursor against a network height the
 * scheduler last read up to a minute ago, which understates lag by as much as
 * twenty blocks and would let a syncer that has genuinely fallen behind carry
 * on pacing itself at live cadence. A block header's own timestamp costs no
 * extra request and is never stale. It also classifies backfill work correctly
 * with no special case: a block pulled from hours ago reads as enormously old,
 * which is precisely the unpaced treatment it should get, since pacing a
 * backfill block at live cadence spends a live block's slot on it.
 *
 * @param blockTime - The block header timestamp, already normalized to a Date.
 * @param now - Current wall-clock time in milliseconds, passed in so callers in
 *              tests can drive it.
 * @param intervalMs - One block time, used to convert the age into blocks.
 * @returns How many blocks behind the chain head this block was when it reached
 *          processing, floored at zero, expressed in the same units as the
 *          pacing thresholds so it can be compared against them directly.
 */
export function resolveBlockAgeInBlocks(blockTime: Date, now: number, intervalMs: number): number {
    const ageMs = now - blockTime.getTime();

    if (!Number.isFinite(ageMs) || ageMs <= 0 || intervalMs <= 0) {
        return 0;
    }

    const result = Math.floor(ageMs / intervalMs);

    return result;
}
