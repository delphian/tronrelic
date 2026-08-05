/**
 * @fileoverview Lag tone thresholds for the System page's blockchain telemetry.
 *
 * The Overview strip's Chain tile and the Blockchain section's Lag figure report
 * the same number, so they have to agree on when it stops reading as healthy —
 * otherwise the tile warns while the section directly beneath it still shows
 * green, and an operator cannot tell which one to believe. Both resolve their
 * thresholds here so the two cannot drift apart.
 *
 * The amber step is the lag at which the syncer itself gives up the live
 * 3-second throttle and starts running flat out, so the console turns amber
 * exactly when sync stops behaving as caught up. That edge is configurable
 * (`backfillEntryBlocks`, set by `BLOCKCHAIN_BACKFILL_ENTRY_BLOCKS`), so it is
 * read from the blockchain status payload rather than copied here — a constant
 * would keep warning at the default 30 in an environment tuned to something
 * else, telling an operator the console line and the syncer's mode line are the
 * same when they are not. Only the entry edge is mirrored: the syncer resumes
 * the throttle at a *lower* lag (`liveChainThrottleBlocks`), a deliberate dead
 * band that stops the mode flapping, and a tile that tracked both edges would
 * flicker through the band the same way the mode used to. See
 * docs/system/system-blockchain-sync-architecture.md.
 */

/**
 * Amber step used until the status payload resolves, or when it omits the field.
 *
 * Mirrors `backfillEntryBlocks`' own default so a console rendered before its
 * first poll lands still colours lag the way a default deployment behaves.
 */
export const LAG_WARNING_BLOCKS_FALLBACK = 30;

/** At or above this many blocks behind, lag reads as failing (red). */
export const LAG_DANGER_BLOCKS = 100;

/**
 * Resolve the amber step from the syncer's configured backfill entry lag.
 *
 * The console must warn exactly where sync changes pacing mode, so it takes the
 * number from the running backend instead of assuming the default. The value is
 * guarded because it arrives over the network: it is absent before the first
 * poll resolves and could be missing or nonsensical from a mismatched backend.
 *
 * @param backfillEntryBlocks - Entry threshold echoed by the blockchain status payload.
 * @returns Blocks-behind figure at or above which lag should read as degraded.
 */
export function resolveLagWarningBlocks(backfillEntryBlocks: number | null | undefined): number {
    let warningBlocks = LAG_WARNING_BLOCKS_FALLBACK;

    if (typeof backfillEntryBlocks === 'number' && Number.isFinite(backfillEntryBlocks) && backfillEntryBlocks > 0) {
        warningBlocks = backfillEntryBlocks;
    }

    return warningBlocks;
}
