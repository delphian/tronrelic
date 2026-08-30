/**
 * @fileoverview The backend playout buffer for fetched blocks.
 *
 * This class holds blocks and decides *when* each one is released. What a
 * release then does — write the block, notify observers, ingest alerts,
 * broadcast `block:new` — belongs to `block-committer.ts` and is injected
 * through {@link BlockEmitter.setCommitSink}. Keeping the two apart is what lets
 * one clock drive everything downstream of the fetch.
 *
 * The buffer sits between fetching and writing on purpose. When it paced only
 * the WebSocket broadcast, the REST endpoints read a height the live feed had
 * not reached, and observer-derived data was written at a third height again.
 * Holding *unwritten* blocks means nothing exists at a height until its slot
 * arrives, so every read surface agrees by construction. The cost is that the
 * whole deployment sits about a buffer's depth behind the chain head.
 *
 * Ingestion and broadcast used to be the same loop. The BullMQ worker fetched a
 * block, wrote it, then slept until its three-second slot was due and only then
 * broadcast it. Because that worker runs one job at a time, sleeping and
 * fetching could not overlap: the pipeline never held a single fetched block in
 * reserve, so a slow TronGrid response, a retry, or a late scheduler tick went
 * straight to the screen as a gap in the feed.
 *
 * This class is the other half of the split. The worker now fetches and parses
 * flat out and hands each prepared block here; the emitter holds a small lead
 * and releases them on its own clock. A hiccup upstream is then covered by the
 * lead instead of being visible, and the feed keeps its cadence.
 *
 * Two properties are worth stating because they are easy to lose in a rewrite.
 * The lead is built once at startup by holding the first `targetDepth` blocks,
 * and it is *rebuilt* after a drain by releasing slightly slower than blocks
 * arrive — without that second part the buffer spends its lead on the first
 * hole and never gets it back, which is the known limitation of the frontend
 * playout buffer in `SocketBridge.tsx`. And a block that is not live work is
 * never buffered at all: spending a live block's slot on a block from hours ago
 * is what puts the syncer further behind.
 *
 * The five numbers shaping the clock are stored configuration, edited from the
 * Configuration tab of `/system/system` and applied to the running instance
 * through {@link BlockEmitter.configure}. They were environment variables until
 * the loop that decides them proved unusable: the only reliable signal that a
 * lead is too small is the underrun count on `/system`, which is a reading you
 * take from a running deployment, and acting on it used to require editing a
 * `.env` file and recreating the container.
 *
 * @module backend/modules/blockchain/block-emitter
 */

import type { BlockStats } from '../../database/models/block-model.js';
import type { IBlockData, ISystemConfig } from '@/types';
import { blockchainConfig } from '../../config/blockchain.js';
import { EMIT_BUFFER_DEFAULTS } from '../../config/emit-buffer.js';
import { logger } from '../../lib/logger.js';
import { resolveEmitPacing } from './block-pacer.js';
import {
    resolveReleaseInterval,
    resolveSeedComplete,
    insertPendingBlock,
    type IReleaseIntervalThresholds
} from './block-emit-buffer.js';

/** The `block:new` payload, built by the worker and held until its slot is due. */
export interface IBlockNewPayload {
    /** Block height, which is also the key the buffer keeps in order. */
    blockNumber: number;
    /** Block header timestamp as an ISO string, ready for the wire. */
    timestamp: string;
    /**
     * Whether the receipt-derived figures in `stats` are measurements or
     * structural zeros. Carried on the event because a live consumer reading
     * the energy totals has no other way to tell the two apart.
     */
    receiptsFetched: boolean;
    /** Block aggregates plus the transaction count the frontend displays. */
    stats: BlockStats & { transactions: number };
}

/**
 * The five operator-tunable settings that shape the release clock.
 *
 * Taken as a slice of the stored system configuration rather than as a separate
 * shape, so a field renamed on the admin form cannot silently stop reaching the
 * emitter — the compiler catches it here instead.
 */
export type IEmitBufferSettings = Pick<
    ISystemConfig,
    | 'emitBufferTargetDepth'
    | 'emitBufferCatchupDepth'
    | 'emitBufferMaxDepth'
    | 'emitBufferRefillIntervalMs'
    | 'emitBufferCatchupIntervalMs'
>;

/**
 * A block that has been fetched and parsed but not yet written.
 *
 * This is what the buffer holds, and the fact that it is *unwritten* is the
 * point. Nothing about the block is in MongoDB until its slot arrives, so the
 * REST endpoints, a server-rendered page, plugin-derived collections, and the
 * live feed all report the same height rather than three different ones. It
 * also means a process that dies loses only work that was never recorded: the
 * sync cursor never advanced past these blocks, so the next tick fetches them
 * again with no repair machinery needed.
 *
 * The buffer therefore holds a block's whole parsed transaction list rather than
 * a small aggregate. `emitBufferMaxDepth` is what bounds that.
 */
export interface IPreparedBlock {
    /** Block height, used to keep the buffer in ascending order. */
    blockNumber: number;
    /** The event to hand to the WebSocket server when the block is committed. */
    payload: IBlockNewPayload;
    /** The assembled block, including every parsed transaction, for observers and the write. */
    blockData: IBlockData;
    /** Block aggregates, stored on the block document and sent on the wire. */
    stats: BlockStats;
    /**
     * How many transactions the block held before parsing dropped any.
     * Recorded separately from `blockData.transactionCount`, which counts only
     * those that survived, because the block document has always stored the raw
     * figure and changing it would silently rewrite history.
     */
    rawTransactionCount: number;
    /** Per-stage timings accumulated while preparing, extended during the commit. */
    timings: Record<string, number>;
}

/**
 * What the emitter does with a block when its slot arrives.
 *
 * Declared here rather than in `block-committer.ts` so the dependency runs one
 * way: the emitter owns the contract for a release and knows nothing about
 * MongoDB, observers, alerts, or the WebSocket server, and the committer
 * implements it.
 */
export interface IBlockCommitSink {
    /**
     * Take one released block and make it real — write it, then announce it.
     *
     * Must return promptly rather than awaiting the write, because this is
     * called from the release timer and the clock measures slots rather than
     * how long a write takes.
     *
     * @param prepared - The block whose slot has arrived.
     */
    submit(prepared: IPreparedBlock): void;
}

/** What the emitter reports to `/system` about its own health. */
export interface IBlockEmitBufferMetrics {
    /** Blocks held right now. This is the lead available to cover a hiccup. */
    depth: number;
    /** The lead the emitter is aiming to hold, echoed so a console can judge depth. */
    targetDepth: number;
    /** False while the initial lead is still being built after a restart. */
    seeded: boolean;
    /**
     * Height of the last block handed to the commit sink, or null before the
     * first. This is a release metric, not a broadcast one — the block reaches
     * clients later, inside the commit. Read `lastCommittedBlockNumber` from
     * the committer for the height a viewer has actually seen.
     */
    lastReleasedBlockNumber: number | null;
    /** Spacing chosen for the most recent release, which reveals the active mode. */
    lastIntervalMs: number | null;
    /**
     * How many times the buffer has drained to empty. This is the single number
     * that says whether the lead is sized right: a healthy deployment holding a
     * real lead never reaches zero, so any increase means the feed was exposed
     * to an upstream gap.
     */
    underruns: number;
    /** How many times a catch-up run flushed the buffer, bypassing the clock. */
    flushes: number;
}

/**
 * Holds finished blocks and releases them on a steady clock.
 *
 * One instance per process, because it owns the feed's cadence and two of them
 * would run two independent clocks against the same set of connected clients.
 * The constructor stays public and takes its collaborators as arguments so
 * tests can drive it with a fake release function and their own thresholds
 * rather than a live WebSocket server.
 */
export class BlockEmitter {
    private static instance: BlockEmitter | null = null;

    /**
     * The most recent thresholds resolved from stored configuration, held here
     * so bootstrap can settle them before the emitter itself exists.
     *
     * The emitter is built lazily, on the first block, because constructing it
     * reaches for the WebSocket server. Configuration is read much earlier, and
     * it must not force that construction just to hand over five numbers.
     * Stashing them means an early read is not lost: `getInstance()` picks them
     * up when it finally builds the emitter, and a later change goes straight
     * to the live instance.
     */
    private static configuredThresholds: IReleaseIntervalThresholds | null = null;

    /**
     * The fan-out installed by {@link BlockEmitter.setCommitSink}, or null when
     * nothing has installed one and a release should only broadcast.
     */
    private static commitSink: IBlockCommitSink | null = null;

    /** Blocks awaiting release, kept in ascending block-number order. */
    private readonly pending: IPreparedBlock[] = [];

    /** The timer for the next release, or null when nothing is scheduled. */
    private timer: NodeJS.Timeout | null = null;

    /**
     * True when the pending timer is a seed re-check rather than a release.
     * Kept apart because an arrival that completes the seed must cancel that
     * wait and start releasing, whereas an arrival during a normal release wait
     * must leave the clock alone.
     */
    private timerIsSeedWait = false;

    /**
     * When the next release is due, carried between releases so a slot that
     * overruns shortens the following wait. See `block-pacer.ts` for why a
     * per-release stopwatch drifts instead of holding a cadence.
     */
    private nextEmitAt = 0;

    /** False until the initial lead has been built; see `resolveSeedComplete`. */
    private seeded = false;

    /** When the first block arrived, which bounds how long seeding may take. */
    private firstArrivalAt: number | null = null;

    private lastReleasedBlockNumber: number | null = null;
    private lastIntervalMs: number | null = null;
    private underruns = 0;
    private flushes = 0;

    /**
     * Build an emitter around a release function and a set of thresholds.
     *
     * Both are arguments rather than module imports so a test can assert on
     * exactly which blocks were released, in what order, and at what spacing,
     * without a WebSocket server or the deployment's configuration.
     *
     * @param release - Called with each block when its slot arrives. Takes the
     *                  whole pending item rather than just the wire payload,
     *                  because releasing a block now means announcing it to
     *                  observers and alerts as well as broadcasting it. Errors
     *                  thrown here are caught and logged rather than allowed to
     *                  escape into the timer, where they would kill the clock
     *                  and stall the feed permanently.
     * @param thresholds - Depths and intervals shaping the release clock. Not
     *                     readonly, because an operator can change them from the
     *                     admin console while the feed is running; see
     *                     {@link applyThresholds}.
     * @param maxDebtBlocks - How much missed deadline one stall may work off at
     *                        full speed, bounding the burst after a stall.
     */
    constructor(
        private readonly release: (item: IPreparedBlock) => void,
        private thresholds: IReleaseIntervalThresholds,
        private readonly maxDebtBlocks: number
    ) {}

    /**
     * Install what a release does with a block.
     *
     * This is a setter rather than a constructor argument because of an ordering
     * problem constructor injection cannot solve. `BlockchainService` obtains
     * the emitter in a field initializer, which runs before its constructor
     * body, and the committer needs the alert service that same constructor body
     * creates. Calling this once the committer exists is the smallest
     * arrangement that keeps the emitter free of MongoDB, the observer registry,
     * the alert service, and the WebSocket service.
     *
     * **A buffer with no sink installed drops its blocks.** That is deliberate
     * and it is not a silent failure, because a released block is unwritten:
     * broadcasting it without committing it would announce a height nothing else
     * can see, which is exactly the split this design exists to remove. A
     * process that only reads emit-buffer metrics never enqueues a block, so it
     * never reaches this path.
     *
     * @param sink - What to do with each released block. Read fresh on every
     *               release, so installing it after the emitter has already been
     *               built takes effect on the next slot.
     */
    public static setCommitSink(sink: IBlockCommitSink): void {
        BlockEmitter.commitSink = sink;
    }

    /**
     * Get the process-wide emitter, creating it on first use.
     *
     * Built lazily rather than at module load so importing this file — which
     * `system-monitor.service.ts` does purely to read metrics — never forces
     * construction before the rest of the pipeline is wired.
     *
     * @returns The single emitter for this process.
     */
    public static getInstance(): BlockEmitter {
        if (!BlockEmitter.instance) {
            BlockEmitter.instance = new BlockEmitter(
                item => {
                    // Read the sink per release rather than capturing it,
                    // because the emitter is built on the first block and the
                    // committer may be installed either side of that moment.
                    const sink = BlockEmitter.commitSink;

                    if (sink) {
                        sink.submit(item);
                    } else {
                        logger.error(
                            { blockNumber: item.blockNumber },
                            'Released a block with no commit sink installed; the block was not written'
                        );
                    }
                },
                BlockEmitter.configuredThresholds ?? BlockEmitter.resolveThresholds(EMIT_BUFFER_DEFAULTS),
                blockchainConfig.network.maxPacingDebtBlocks
            );
        }

        return BlockEmitter.instance;
    }

    /**
     * Adopt the emit-buffer settings an operator has saved.
     *
     * This is the single entry point for stored configuration, called once at
     * startup and again on every save from the Configuration tab. Callers pass
     * the settings in rather than the emitter reading the database itself,
     * which keeps this class free of the config service and lets a test drive
     * it with plain numbers.
     *
     * Safe to call before the emitter exists. The settings are held and applied
     * when it is built, which is what lets bootstrap configure the buffer
     * without forcing a WebSocket service into existence at the same moment.
     *
     * @param settings - The five stored values, straight off the system config
     *                   document.
     */
    public static configure(settings: IEmitBufferSettings): void {
        BlockEmitter.configuredThresholds = BlockEmitter.resolveThresholds(settings);

        if (BlockEmitter.instance) {
            BlockEmitter.instance.applyThresholds(BlockEmitter.configuredThresholds);
        }
    }

    /**
     * Turn stored settings into thresholds, correcting an ordering that would
     * stop the buffer working at all.
     *
     * The depths have to increase — target, then catch-up, then the cap — and
     * nothing stops an operator raising the target past the catch-up depth
     * without touching the other two. That combination fails quietly and in the
     * worst possible way: every depth above the catch-up figure drains at the
     * faster interval, so the buffer speeds up before it ever reaches its
     * target and settles permanently short of the lead it was configured to
     * hold. Nothing errors, and the only visible symptom is a feed that still
     * stutters. Lifting the two upper depths clear of the target keeps the
     * deployment running with the lead it asked for, and the warning says what
     * was changed so the configuration can be fixed properly.
     *
     * The update endpoint rejects this ordering outright, so a save from the
     * admin console cannot reach here broken. The correction stays because a
     * config document can also be edited directly in MongoDB, and because the
     * emitter must never be the thing that fails on a bad number.
     *
     * @param settings - The five stored values to convert.
     * @returns Thresholds safe to release against, with the block interval
     *          taken from the chain's own production rate rather than from
     *          anything an operator can set.
     */
    private static resolveThresholds(settings: IEmitBufferSettings): IReleaseIntervalThresholds {
        const targetDepth = settings.emitBufferTargetDepth;
        const catchupDepth = Math.max(settings.emitBufferCatchupDepth, targetDepth + 1);
        const maxDepth = Math.max(settings.emitBufferMaxDepth, catchupDepth + 1);

        if (catchupDepth !== settings.emitBufferCatchupDepth || maxDepth !== settings.emitBufferMaxDepth) {
            logger.warn(
                {
                    targetDepth,
                    configuredCatchupDepth: settings.emitBufferCatchupDepth,
                    configuredMaxDepth: settings.emitBufferMaxDepth,
                    catchupDepth,
                    maxDepth
                },
                'Emit buffer depths were not increasing; raised them above the target so the buffer can reach its lead'
            );
        }

        const thresholds: IReleaseIntervalThresholds = {
            intervalMs: blockchainConfig.network.blockIntervalSeconds * 1000,
            refillIntervalMs: settings.emitBufferRefillIntervalMs,
            catchupIntervalMs: settings.emitBufferCatchupIntervalMs,
            targetDepth,
            catchupDepth,
            maxDepth
        };

        return thresholds;
    }

    /**
     * Switch the running buffer over to a new set of thresholds.
     *
     * The pending timer is cancelled and the next release rescheduled, because
     * a wait already counting down was sized by the old interval. Without that,
     * a change saved during a 3.3-second wait would appear to do nothing until
     * that wait happened to expire, and an operator watching the console would
     * reasonably conclude the save had failed.
     *
     * Nothing else needs handling explicitly, because the release clock reads
     * these values fresh on every decision. A lowered target leaves the buffer
     * above its new catch-up depth, so the excess drains at the faster interval
     * and settles; a raised target leaves it below, so it refills at the slower
     * one and grows the lead back over the following minute. A buffer still
     * building its initial lead re-tests that against the new target the moment
     * it is rescheduled.
     *
     * @param next - Thresholds already ordered and clamped by
     *               {@link resolveThresholds}.
     */
    public applyThresholds(next: IReleaseIntervalThresholds): void {
        this.thresholds = next;

        this.clearTimer();
        this.scheduleNext();

        logger.info(
            {
                targetDepth: next.targetDepth,
                catchupDepth: next.catchupDepth,
                maxDepth: next.maxDepth,
                refillIntervalMs: next.refillIntervalMs,
                catchupIntervalMs: next.catchupIntervalMs,
                depth: this.pending.length
            },
            'Emit buffer thresholds applied to the running feed'
        );
    }

    /**
     * Hand a live block to the buffer to be released on the emitter's clock.
     *
     * Use this for blocks that are current work. Anything older belongs on
     * {@link emitNow}, because holding a backfill block for a live slot spends
     * that slot on data nobody is waiting for.
     *
     * @param item - The block number and the event to broadcast for it.
     */
    public enqueue(item: IPreparedBlock): void {
        insertPendingBlock(this.pending, item);

        if (this.firstArrivalAt === null) {
            this.firstArrivalAt = Date.now();
        }

        // An arrival that completes the seed has to cancel the seed wait, or
        // the buffer would sit on a full lead until a timer set for the
        // worst case finally fired.
        if (this.timerIsSeedWait) {
            this.clearTimer();
        }

        this.scheduleNext();
    }

    /**
     * Commit a block immediately instead of waiting for a slot.
     *
     * Two different kinds of block take this path, and they need opposite
     * treatment. A catch-up block is newer than everything the buffer holds, so
     * the buffer is flushed first: releasing the newer block on its own would
     * show a height that then jumps back down. The carried deadline is cleared
     * with it, so the first paced block after a catch-up run starts a fresh
     * cadence from itself rather than working off a debt it did not cause.
     *
     * A backfill block is older than everything held, and flushing for it buys
     * nothing. The old block is going to arrive after heights above it either
     * way, because that is what backfilling a hole means, so no flush can make
     * the sequence monotonic. What the flush does cost is the whole lead: it
     * commits the held live blocks early, in one burst, and leaves the buffer
     * empty until the refill interval rebuilds it — so the next upstream hiccup
     * is visible. An old block is therefore committed on its own and the buffer
     * is left alone, still holding its lead and still counting down to its next
     * slot.
     *
     * The seeded flag is deliberately left alone in both cases. Re-seeding here
     * would stall the feed for a full lead's worth of time every time the syncer
     * recovered, which is exactly when a viewer is already waiting.
     *
     * @param item - The prepared block to commit now, whether it is a catch-up
     *               block ahead of the buffer or a backfill block behind it.
     */
    public emitNow(item: IPreparedBlock): void {
        const highestHeld = this.pending.at(-1)?.blockNumber ?? null;

        if (highestHeld === null || item.blockNumber > highestHeld) {
            this.clearTimer();
            this.flushPending();
            this.emit(item);
            this.nextEmitAt = 0;
        } else {
            this.emit(item);
        }
    }

    /**
     * Report the buffer's state for the `/system` blockchain console.
     *
     * @returns A snapshot an operator can read to tell a healthy lead from one
     *          that keeps draining, without needing access to the process.
     */
    public getMetrics(): IBlockEmitBufferMetrics {
        const metrics: IBlockEmitBufferMetrics = {
            depth: this.pending.length,
            targetDepth: this.thresholds.targetDepth,
            seeded: this.seeded,
            lastReleasedBlockNumber: this.lastReleasedBlockNumber,
            lastIntervalMs: this.lastIntervalMs,
            underruns: this.underruns,
            flushes: this.flushes
        };

        return metrics;
    }

    /**
     * Stop the clock and discard whatever is held.
     *
     * Discarding is correct here, and it is a deliberate reversal of what this
     * method used to do. When the buffer held blocks that were already written
     * and only awaiting a broadcast, flushing them on shutdown was right —
     * dropping them denied clients data the backend already had. The buffer now
     * holds blocks that have *not* been written, so there is nothing to deny
     * anyone: the sync cursor never advanced past them and the next process
     * fetches them again. Rushing a batch of writes into the seconds before
     * `process.exit` would only risk tearing one of them partway through.
     */
    public stop(): void {
        this.clearTimer();

        if (this.pending.length > 0) {
            logger.info(
                { discarded: this.pending.length, from: this.pending[0]?.blockNumber },
                'Discarding unwritten buffered blocks on shutdown; the next process will fetch them again'
            );
            this.pending.length = 0;
        }
    }

    /**
     * Work out when the next release is due and set a timer for it.
     *
     * Returns without doing anything when a timer is already pending or the
     * buffer is empty. The empty case is not an error: the clock simply stops
     * until the next arrival restarts it through {@link enqueue}, which is what
     * makes an underrun recover immediately rather than waiting out a slot.
     */
    private scheduleNext(): void {
        if (this.timer || this.pending.length === 0) {
            return;
        }

        const now = Date.now();

        if (!this.seeded) {
            this.seeded = resolveSeedComplete({
                depth: this.pending.length,
                targetDepth: this.thresholds.targetDepth,
                firstArrivalAt: this.firstArrivalAt,
                now,
                intervalMs: this.thresholds.intervalMs
            });

            if (!this.seeded) {
                this.scheduleSeedRecheck(now);
                return;
            }
        }

        const intervalMs = resolveReleaseInterval(this.pending.length, this.thresholds);
        let delayMs: number;

        if (intervalMs <= 0) {
            // The buffer has grown past the point where holding blocks back
            // helps, so latency is now the bigger problem than jitter. The
            // pacer is bypassed rather than called with a zero interval,
            // because a deadline still sitting in the future would make it
            // wait through the very backlog this is meant to drain.
            delayMs = 0;
            this.nextEmitAt = now;
        } else {
            const pacing = resolveEmitPacing({
                now,
                nextEmitAt: this.nextEmitAt,
                intervalMs,
                maxDebtBlocks: this.maxDebtBlocks
            });

            delayMs = pacing.delayMs;
            this.nextEmitAt = pacing.nextEmitAt;
        }

        this.lastIntervalMs = intervalMs;
        this.setTimer(() => this.releaseOne(), delayMs, false);
    }

    /**
     * Wait for the rest of the seeding window and then look again.
     *
     * Without this timer a syncer that received fewer blocks than the target
     * and then went quiet would hold them forever, because nothing else would
     * re-run the seed check. The wait is the remainder of the same window
     * {@link resolveSeedComplete} measures, so it can only end seeding on time,
     * never late.
     *
     * @param now - Current time, taken once by the caller so the wait and the
     *              seed decision cannot disagree by a few milliseconds.
     */
    private scheduleSeedRecheck(now: number): void {
        const windowMs = this.thresholds.targetDepth * this.thresholds.intervalMs;
        const elapsedMs = this.firstArrivalAt === null ? 0 : now - this.firstArrivalAt;
        const waitMs = Math.max(0, windowMs - elapsedMs);

        this.setTimer(() => this.scheduleNext(), waitMs, true);
    }

    /**
     * Broadcast the oldest held block and line up the next release.
     *
     * Draining to empty is counted as an underrun, because a buffer at zero has
     * no lead left and the next upstream gap will be visible. That count is the
     * signal an operator uses to decide the target depth is too small.
     */
    private releaseOne(): void {
        const next = this.pending.shift();

        if (!next) {
            return;
        }

        this.emit(next);

        if (this.pending.length === 0) {
            this.underruns += 1;
        }

        this.scheduleNext();
    }

    /**
     * Release everything held, in order, with no waiting.
     *
     * Used by a catch-up run, where the held blocks are already late and
     * spacing them out would only add to the delay. Shutdown deliberately does
     * not come here; see {@link stop}.
     */
    private flushPending(): void {
        if (this.pending.length === 0) {
            return;
        }

        this.flushes += 1;

        while (this.pending.length > 0) {
            this.emit(this.pending.shift() as IPreparedBlock);
        }
    }

    /**
     * Hand one block to the release function and record that it went out.
     *
     * The release function is wrapped because it reaches the committer, and an
     * error escaping from inside a timer callback would take down the release
     * clock with it — leaving the buffer filling and the pipeline frozen with no
     * obvious cause. Losing one block is recoverable, because an uncommitted
     * block leaves the cursor where it was and the next tick fetches it again.
     * Losing the clock is not.
     *
     * @param item - The block being released.
     */
    private emit(item: IPreparedBlock): void {
        try {
            this.release(item);
            this.lastReleasedBlockNumber = item.blockNumber;
        } catch (error) {
            logger.error({ error, blockNumber: item.blockNumber }, 'Failed to hand a released block to the committer');
        }
    }

    /**
     * Set the single pending timer, recording what kind of wait it is.
     *
     * The handle is unreferenced so a scheduled release can never hold the
     * process open on shutdown; the flush in {@link stop} is what makes sure
     * nothing is silently dropped when that happens.
     *
     * @param run - What to do when the wait expires.
     * @param delayMs - How long to wait.
     * @param isSeedWait - True for a seed re-check, so an arrival that
     *                     completes the lead knows it may cancel this timer.
     */
    private setTimer(run: () => void, delayMs: number, isSeedWait: boolean): void {
        this.timerIsSeedWait = isSeedWait;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.timerIsSeedWait = false;
            run();
        }, delayMs);
        this.timer.unref?.();
    }

    /** Cancel the pending timer, if any, and forget what kind of wait it was. */
    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.timerIsSeedWait = false;
    }
}
