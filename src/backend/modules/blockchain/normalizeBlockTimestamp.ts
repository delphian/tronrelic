/**
 * @fileoverview Turning a block header's raw timestamp into a valid date.
 *
 * TronGrid normally reports a block's time in epoch milliseconds, but some
 * responses carry it scaled up by a thousand, or a thousand twice. Block sync
 * and the chain data repair job both read that header, and a block written
 * with the wrong time lands in the wrong ClickHouse day partition, so the two
 * must normalize it the same way. This is the one place that rule lives.
 *
 * @module backend/modules/blockchain/normalizeBlockTimestamp
 */

/**
 * The largest value that can still be epoch milliseconds for a date in the
 * foreseeable future. A larger number has been scaled up by a factor of a
 * thousand and is divided back down.
 */
const MAX_EPOCH_MS = 9_999_999_999_999;

/**
 * Normalize a block header's raw timestamp into a date.
 *
 * A number is brought back into epoch milliseconds by dividing by a thousand
 * up to twice, for as long as it is too large to be milliseconds. A string is
 * passed to `Date` as it is, which is what sync has always done with one.
 *
 * @param raw - `block_header.raw_data.timestamp` exactly as TronGrid returned it.
 * @returns The block's time, or null when the value does not describe a valid
 *          date, so the caller can decide whether that is fatal for the block.
 */
export function normalizeBlockTimestamp(raw: number | string): Date | null {
    let normalized: number | string = raw;

    if (typeof raw === 'number') {
        let milliseconds = raw;
        if (milliseconds > MAX_EPOCH_MS) {
            milliseconds = Math.floor(milliseconds / 1_000);
        }
        if (milliseconds > MAX_EPOCH_MS) {
            milliseconds = Math.floor(milliseconds / 1_000);
        }
        normalized = milliseconds;
    }

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}
