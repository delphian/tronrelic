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
 * These are the numbers the removed environment variables defaulted to, so a
 * deployment that never set them behaves identically after the migration.
 * Eight blocks of lead covers a fully missed sync tick plus a skipped chain
 * slot, and 3300ms is deliberately longer than one block time, because
 * releasing slower than blocks arrive is the only way a lead spent covering a
 * gap grows back rather than staying spent.
 */
export const EMIT_BUFFER_DEFAULTS = {
    /** Blocks of lead to hold. Zero switches buffering off entirely. */
    emitBufferTargetDepth: 8,
    /** Depth at which draining speeds up so a tick's burst is not held as latency. */
    emitBufferCatchupDepth: 13,
    /** Depth beyond which blocks go out with no wait at all. */
    emitBufferMaxDepth: 40,
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
