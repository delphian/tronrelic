/**
 * @fileoverview How fast the block emitter releases what it is holding.
 *
 * The syncer used to hold each block for its three-second slot inside the
 * BullMQ worker, immediately before broadcasting it. That worker runs one job
 * at a time, so while it waited on block N it was not fetching block N+1, and
 * the pipeline could never accumulate fetched-but-unbroadcast blocks. Every
 * fetch stall, retry, or late scheduler tick therefore landed straight in the
 * visible feed as a gap, and nothing on the backend could cover it.
 *
 * Splitting ingestion from broadcast fixes that, but only if the side doing the
 * broadcasting keeps a lead. The functions here decide how big that lead should
 * be and how fast to spend it: release slightly slower than the chain produces
 * while the lead is short so it rebuilds, at the chain's own cadence once it is
 * full, and faster when a scheduler tick has just delivered a burst.
 *
 * The arithmetic lives here as pure functions, like `sync-mode.ts` and
 * `block-pacer.ts`, so the behaviour can be pinned by tests rather than buried
 * in the emitter's timers.
 *
 * @module backend/modules/blockchain/block-emit-buffer
 */

/**
 * The depths and intervals that shape the emitter's release clock.
 *
 * Two of these intervals exist to pull depth back toward `targetDepth`, and the
 * buffer only settles there because both are present. `refillIntervalMs` must be
 * strictly greater than `intervalMs`, or a lead spent on one gap can never grow
 * back: releasing at exactly the rate blocks arrive holds whatever depth it
 * already has forever. `drainIntervalMs` must be strictly less than
 * `intervalMs` for the same reason in the other direction — without it every
 * depth from `targetDepth` up to `catchupDepth` released at the chain's own
 * rate, so a burst that pushed the buffer into that band left it there for the
 * life of the process, holding latency the operator never asked for. That is
 * how the removed frontend playout buffer ended up permanently behind.
 *
 * `catchupDepth` must sit above `targetDepth`, and `maxDepth` above both, or
 * the faster intervals take over the steady-state cadence.
 */
export interface IReleaseIntervalThresholds {
    /** Target spacing once the buffer holds exactly its lead — one TRON block time. */
    intervalMs: number;
    /**
     * Spacing used while the buffer is below target. Deliberately longer than
     * `intervalMs`, because releasing slower than blocks arrive is the only way
     * a lead can grow back after it has been spent.
     */
    refillIntervalMs: number;
    /**
     * Spacing used while the buffer is above target but below `catchupDepth`.
     * Deliberately shorter than `intervalMs`, so a surplus left by a burst is
     * given back instead of being held as permanent feed latency.
     */
    drainIntervalMs: number;
    /** Spacing used to drain the burst a scheduler tick delivers. */
    catchupIntervalMs: number;
    /** Depth the buffer aims to hold, which is the lead a hiccup draws from. */
    targetDepth: number;
    /** Depth at or above which the buffer drains at `catchupIntervalMs`. */
    catchupDepth: number;
    /** Depth at or above which blocks are released with no wait at all. */
    maxDepth: number;
}

/** Everything needed to decide whether the initial lead has been built. */
export interface ISeedCompleteInput {
    /** How many blocks the buffer is holding right now. */
    depth: number;
    /** The lead the buffer wants before it starts releasing. */
    targetDepth: number;
    /**
     * When the first block arrived after the emitter started, in milliseconds.
     * Null before anything has arrived, which cannot be a completed seed.
     */
    firstArrivalAt: number | null;
    /** Current wall-clock time in milliseconds, passed in so tests can drive it. */
    now: number;
    /** One block time, used to bound how long seeding may take. */
    intervalMs: number;
}

/**
 * Work out the gap to leave before releasing the next block.
 *
 * Depth is measured before the release rather than after, so a buffer sitting
 * exactly at target releases at the chain's cadence, one block short slows down
 * to rebuild, and one block over speeds up to give the surplus back. Only the
 * exact target releases at the chain's own rate, which is what makes target the
 * one depth the buffer settles at rather than a floor it can sit above.
 *
 * Getting that wrong is subtle, because a buffer that is too deep still looks
 * healthy on the console — depth is above target and no underruns are counted.
 * What it costs is feed latency: every extra block held is three more seconds
 * between a block existing on TRON and a viewer seeing it, and holding a
 * surplus buys no more protection than the configured lead already provides.
 *
 * @param depth - Blocks currently held, counted before this release. Zero means
 *                there is nothing to release and the caller should wait for an
 *                arrival rather than scheduling anything.
 * @param thresholds - The deployment's depths and intervals, passed in rather
 *                     than read from config here so tests can cover the
 *                     boundaries without touching the environment.
 * @returns Milliseconds to leave before the next release, where zero means
 *          release immediately because the buffer has grown past the point
 *          where holding blocks back helps anyone.
 */
export function resolveReleaseInterval(depth: number, thresholds: IReleaseIntervalThresholds): number {
    let intervalMs: number;

    if (depth >= thresholds.maxDepth) {
        intervalMs = 0;
    } else if (depth >= thresholds.catchupDepth) {
        intervalMs = thresholds.catchupIntervalMs;
    } else if (depth > thresholds.targetDepth) {
        intervalMs = thresholds.drainIntervalMs;
    } else if (depth === thresholds.targetDepth) {
        intervalMs = thresholds.intervalMs;
    } else {
        intervalMs = thresholds.refillIntervalMs;
    }

    return intervalMs;
}

/**
 * Decide whether the emitter has built its initial lead and may start
 * releasing.
 *
 * A buffer that has never held anything back has no lead to spend, so the first
 * hole it meets still reaches the screen. Holding the first `targetDepth`
 * blocks is what buys the lead, and it is paid once per process start.
 *
 * The wait is bounded by time as well as by depth. A syncer that starts while
 * the chain is stalled, or one running against a quiet test network, would
 * otherwise hold its first block indefinitely waiting for a depth that is not
 * coming. Both paths cost the same worst case — `targetDepth` block times — so
 * the bound changes when seeding ends, never how long an operator waits for it.
 *
 * @param input - Current depth, the target lead, when the first block arrived,
 *                the current time, and one block time.
 * @returns True once the emitter should begin releasing on its normal clock.
 */
export function resolveSeedComplete(input: ISeedCompleteInput): boolean {
    const { depth, targetDepth, firstArrivalAt, now, intervalMs } = input;

    let complete: boolean;

    if (targetDepth <= 0) {
        complete = true;
    } else if (depth >= targetDepth) {
        complete = true;
    } else if (firstArrivalAt === null) {
        complete = false;
    } else {
        complete = now - firstArrivalAt >= targetDepth * intervalMs;
    }

    return complete;
}

/**
 * Place a block into the pending list so the list stays ordered by block
 * number.
 *
 * Blocks almost always arrive in ascending order, so this walks back from the
 * end and normally stops on the first comparison. The walk exists for the case
 * that does not: a block that failed and was retried can land after a later one
 * is already buffered, and releasing 1002 before 1001 would show the feed
 * running backwards. Re-sorting the whole list on every arrival would reach the
 * same answer at a cost that grows with buffer depth, for no benefit.
 *
 * @param pending - The emitter's list, mutated in place because it is the
 *                  emitter's own state and copying it once per block would
 *                  allocate for nothing.
 * @param item - The block to place.
 * @returns The same list, so a caller can chain or assert on it without needing
 *          to know that the insert mutated its argument.
 */
export function insertPendingBlock<T extends { blockNumber: number }>(pending: T[], item: T): T[] {
    let index = pending.length;

    while (index > 0 && pending[index - 1].blockNumber > item.blockNumber) {
        index -= 1;
    }

    pending.splice(index, 0, item);

    return pending;
}
