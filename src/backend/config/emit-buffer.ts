/**
 * @fileoverview Defaults and accepted ranges for the block emit buffer.
 *
 * The five emit-buffer settings used to be environment variables read at
 * startup, which meant changing the feed's lead required editing the droplet's
 * `.env`, adding the variable to the backend service in `docker-compose.yml`,
 * and recreating the container. They are now fields on the `system_config`
 * document and are edited from the Configuration tab of `/system/system`.
 *
 * That move creates two consumers of the same numbers: the Mongoose schema,
 * which needs a default for a deployment whose config document predates these
 * fields, and `BlockEmitter`, which is built synchronously and cannot wait for
 * a database read before its first block arrives. This file is the one place
 * both read from, so the two can never disagree.
 *
 * It deliberately imports nothing. `config/blockchain.ts` pulls in `env.ts`,
 * which validates the whole environment at import time, and the schema file has
 * to stay loadable in a unit test that has no environment configured.
 *
 * @module backend/config/emit-buffer
 */

/**
 * The values a deployment starts with before an operator changes anything.
 *
 * The lead is sized against the thing that actually interrupts the feed, which
 * is the sync schedule rather than the chain. `blockchain:sync` runs every 15
 * seconds, so one missed tick costs five blocks at TRON's three-second block
 * time, and a super representative skipping its slot costs one more. Twenty
 * covers three missed ticks plus a skipped slot with four blocks to spare, and
 * the spare matters: a tick hands over its whole batch at once, so depth swings
 * roughly a block and a half either side of target even when everything is
 * healthy, and the working floor is below the number set here.
 *
 * The spare also covers how slowly a spent lead returns. The refill interval
 * below is 300ms longer than one block time, so it regains a single block of
 * lead for every ten released; a deployment that hiccups twice in quick
 * succession would otherwise meet the second gap still short. The lead costs
 * 60 seconds of delay on every read surface, because the feed, the REST
 * endpoints, server-rendered pages, and plugin collections all sit behind the
 * buffer together.
 *
 * The two intervals are deliberately not symmetric with each other. 3300ms is
 * longer than one block time, because releasing slower than blocks arrive is
 * the only way a lead spent covering a gap grows back rather than staying
 * spent. 2000ms is short enough to work off the burst a scheduler tick
 * delivers. The spacing used just above target is derived from the refill
 * interval rather than stored here; see `BlockEmitter.resolveThresholds`.
 */
export const EMIT_BUFFER_DEFAULTS = {
    /**
     * Blocks of lead to hold. Zero switches buffering off entirely.
     *
     * Every block of lead is also three seconds of block age, and block age is
     * the figure `resolveBlockPacing` tests to decide whether a block is paced
     * at all. Changing this depth therefore means re-checking
     * `liveChainThrottleBlocks` and `backfillEntryBlocks` in `blockchain.ts`.
     * Both must stay above the steady-state age this depth produces, or sync
     * sits above its own resume threshold and oscillates in and out of
     * catch-up rather than settling.
     */
    emitBufferTargetDepth: 20,
    /**
     * Depth at which draining speeds up so a tick's burst is not held as latency.
     *
     * Must stay strictly above the target depth, because the update endpoint
     * refuses any save where the three depths do not increase. Scale it with
     * the target so a scheduler tick's burst keeps the same room to drain as
     * the target moves.
     */
    emitBufferCatchupDepth: 33,
    /**
     * Depth beyond which blocks go out with no wait at all.
     *
     * Must stay strictly above the catch-up depth, and scales with it so the
     * buffer keeps the same room to absorb a burst before it gives up on
     * spacing releases altogether.
     */
    emitBufferMaxDepth: 66,
    /** Spacing used below target, which is what rebuilds a spent lead. */
    emitBufferRefillIntervalMs: 3300,
    /** Spacing used above the catch-up depth. */
    emitBufferCatchupIntervalMs: 2000
} as const;

/**
 * The inclusive range the update endpoint accepts for each setting.
 *
 * `BlockEmitter` already corrects depths that do not increase, because that
 * particular mistake fails silently and would otherwise leave a buffer
 * permanently short of its lead with nothing in the logs to say so. It does not
 * correct a value that is merely too large, and it should not: an operator who
 * types 800 where they meant 8 has asked for forty minutes of feed latency, and
 * the useful response is to reject the save and explain why rather than to
 * quietly substitute some other number.
 *
 * The target ceiling is 120 blocks, which is six minutes of lead at one block
 * every three seconds — far past any real upstream hiccup, and well short of a
 * value a viewer would read as a frozen feed. The other two depths are allowed
 * progressively higher ceilings because each has to sit above the one before
 * it, and a target at its own ceiling still needs somewhere for them to go.
 *
 * These bounds are a sanity check on a typed value, not the whole contract.
 * Two rules cannot be expressed as a per-field range and are enforced
 * separately by the update endpoint: the three depths must increase, and the
 * refill interval must be longer than one block time.
 */
export const EMIT_BUFFER_LIMITS = {
    emitBufferTargetDepth: { min: 0, max: 120 },
    emitBufferCatchupDepth: { min: 1, max: 240 },
    emitBufferMaxDepth: { min: 2, max: 480 },
    emitBufferRefillIntervalMs: { min: 100, max: 30_000 },
    emitBufferCatchupIntervalMs: { min: 100, max: 30_000 }
} as const;
