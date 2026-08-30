/**
 * @fileoverview Which chain height a sync tick is allowed to schedule against.
 *
 * A sync tick begins by asking TronGrid for the chain head. That single call
 * used to decide the fate of the whole tick: if it failed, nothing was
 * scheduled, including the backfill queue — which is old work that never needed
 * the head at all. One flaky request therefore stopped repair work that would
 * have succeeded.
 *
 * Falling back to the height the previous tick recorded fixes that, but only
 * under a condition that is easy to state and easy to lose in a later edit. The
 * height is safe as the *ceiling* of the forward walk, because that walk starts
 * at the stored cursor and a stale ceiling can only make the batch smaller. It
 * is completely unsafe when there is no cursor, because the service then seeds
 * the cursor *from* the height instead of bounding a walk with it, and a stale
 * value would start the deployment at the wrong place permanently.
 *
 * The rules live here as pure functions, alongside `sync-mode.ts` and
 * `block-pacer.ts`, so that condition is pinned by tests rather than buried in
 * a method that also talks to Redis, MongoDB, and TronGrid.
 *
 * @module backend/modules/blockchain/chain-head
 */

/**
 * Read a stored sync cursor, or report that there is not a usable one.
 *
 * The string case is not defensive padding. Cursors written by older MongoDB
 * driver versions are stored as strings and still have to be read, so a
 * number-only check would silently treat a working deployment as a fresh
 * install and restart its sync from the chain head.
 *
 * @param value - The `cursor.blockNumber` field exactly as it came out of the
 *                sync state document, which is why the parameter is `unknown`
 *                rather than a number: the caller cannot promise the shape.
 * @returns The cursor height, or null when the field is absent or holds
 *          something that cannot be read as a finite number. Null is the
 *          signal that the caller must not treat any height as a ceiling,
 *          because there is no floor to bound it against.
 */
export function resolveCursorBlock(value: unknown): number | null {
    let result: number | null = null;

    if (typeof value === 'number' && Number.isFinite(value)) {
        result = value;
    } else if (typeof value === 'string') {
        const parsed = Number(value);

        result = Number.isFinite(parsed) ? parsed : null;
    }

    return result;
}

/**
 * Decide whether a previously recorded chain height may stand in for a failed
 * head lookup.
 *
 * The answer is no whenever the deployment has no usable cursor. That is the
 * single rule keeping a stale height away from the fresh-install path, where it
 * would be adopted as the starting point rather than used as a bound. A cold
 * start genuinely needs a live head, and waiting for the next tick costs
 * nothing.
 *
 * Note what this deliberately does not do: it never adjusts the height for time
 * elapsed since it was recorded. A height above the real chain head would
 * schedule blocks TRON has not produced, and each one costs six retries in the
 * TronGrid client before landing in cooldown and the backfill queue as a
 * phantom entry. Falling a few blocks short until the head answers is the
 * cheaper failure by a wide margin.
 *
 * @param cursorValue - The `cursor.blockNumber` field from sync state, passed
 *                      raw so this function applies the same reading rules as
 *                      the cursor's other consumer rather than a second copy of
 *                      them.
 * @param heightValue - The `meta.lastNetworkHeight` field from sync state, also
 *                      raw, since it is written by an earlier tick and nothing
 *                      revalidates it in between.
 * @returns The height to schedule against, or null when the caller must let the
 *          lookup failure stand and abort the tick.
 */
export function resolveCachedHead(cursorValue: unknown, heightValue: unknown): number | null {
    let result: number | null = null;

    if (resolveCursorBlock(cursorValue) !== null) {
        if (typeof heightValue === 'number' && Number.isFinite(heightValue) && heightValue > 0) {
            result = heightValue;
        }
    }

    return result;
}
