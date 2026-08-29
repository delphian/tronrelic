/**
 * @fileoverview Lag tone thresholds for the System page's blockchain telemetry.
 *
 * The Overview strip's Chain tile and the Blockchain section's Lag figure report
 * the same number, so they have to agree on when it stops reading as healthy —
 * otherwise the tile warns while the section directly beneath it still shows
 * green, and an operator cannot tell which one to believe. Both resolve their
 * thresholds here so the two cannot drift apart.
 *
 * The amber step is the lag at which the syncer itself stops treating a block
 * as live work — where it stops buffering blocks for the feed's cadence and
 * broadcasts each one the moment it is ready — so the console turns amber
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
 * number from the running backend instead of assuming the default. Both values
 * are guarded because they arrive over the network: they are absent before the
 * first poll resolves and could be missing or nonsensical from a mismatched
 * backend.
 *
 * The held-back figure is added on because the two numbers are counted from
 * different places. Feed lag counts down from the raw chain head and so
 * includes whatever the deployment is deliberately holding, while the mode
 * boundary is about how far behind the chain *ingestion* has fallen. Without
 * the offset the console would turn amber on a deployment behaving exactly as
 * configured, early by exactly the size of the lead it was told to keep.
 *
 * @param backfillEntryBlocks - Entry threshold echoed by the blockchain status payload.
 * @param heldBackBlocks - Blocks the deployment holds on purpose, echoed by the same
 *                         payload: the emitter's buffer target when colouring feed lag,
 *                         or the live tip reserve when colouring ingest lag. Leave it out
 *                         and the amber step lands that many blocks early, reading as a
 *                         fault that is not there.
 * @returns Blocks-behind figure at or above which lag should read as degraded.
 */
export function resolveLagWarningBlocks(
    backfillEntryBlocks: number | null | undefined,
    heldBackBlocks?: number | null
): number {
    let warningBlocks = LAG_WARNING_BLOCKS_FALLBACK;

    if (typeof backfillEntryBlocks === 'number' && Number.isFinite(backfillEntryBlocks) && backfillEntryBlocks > 0) {
        warningBlocks = backfillEntryBlocks;
    }

    if (typeof heldBackBlocks === 'number' && Number.isFinite(heldBackBlocks) && heldBackBlocks > 0) {
        warningBlocks += heldBackBlocks;
    }

    return warningBlocks;
}
