/**
 * @fileoverview Lag tone thresholds for the System page's blockchain telemetry.
 *
 * The Overview strip's Chain tile and the Blockchain section's Lag figure report
 * the same number, so they have to agree on when it stops reading as healthy —
 * otherwise the tile warns while the section directly beneath it still shows
 * green, and an operator cannot tell which one to believe. Both import from
 * here so the thresholds move in one place.
 *
 * The amber step matches the lag at which the syncer itself gives up the live
 * 3-second throttle and starts running flat out (`backfillEntryBlocks`, set by
 * `BLOCKCHAIN_BACKFILL_ENTRY_BLOCKS`), so the console turns amber exactly when
 * sync stops behaving as caught up. The values are held here rather than read
 * from the status payload because the syncer returns to the throttle at a lower
 * lag than it leaves it — a deliberate dead band that stops the mode flapping —
 * and a tile that tracked both edges would flicker through the band the same way
 * the mode used to. Keep this constant in step with that environment variable if
 * either moves; see docs/system/system-blockchain-sync-architecture.md.
 */

/** At or above this many blocks behind, lag reads as degraded (amber). */
export const LAG_WARNING_BLOCKS = 30;

/** At or above this many blocks behind, lag reads as failing (red). */
export const LAG_DANGER_BLOCKS = 100;
