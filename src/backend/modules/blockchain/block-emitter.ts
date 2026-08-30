/**
 * @fileoverview The backend playout buffer for `block:new` broadcasts.
 *
 * Ingestion and broadcast used to be the same loop. The BullMQ worker fetched a
 * block, wrote it, then slept until its three-second slot was due and only then
 * broadcast it. Because that worker runs one job at a time, sleeping and
 * fetching could not overlap: the pipeline never held a single fetched block in
 * reserve, so a slow TronGrid response, a retry, or a late scheduler tick went
 * straight to the screen as a gap in the feed.
 *
 * This class is the other half of the split. The worker now runs flat out and
 * hands each finished event here; the emitter holds a small lead of real blocks
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
import type { ISystemConfig } from '@/types';
import { blockchainConfig } from '../../config/blockchain.js';
import { EMIT_BUFFER_DEFAULTS } from '../../config/emit-buffer.js';
import { logger } from '../../lib/logger.js';
import { WebSocketService } from '../../services/websocket.service.js';
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

/** One block waiting for its broadcast slot. */
export interface IPendingBlockEmit {
    /** Block height, used to keep the buffer in ascending order. */
    blockNumber: number;
    /** The event to hand to the WebSocket server when the slot arrives. */
    payload: IBlockNewPayload;
}

/** What the emitter reports to `/system` about its own health. */
export interface IBlockEmitBufferMetrics {
    /** Blocks held right now. This is the lead available to cover a hiccup. */
    depth: number;
    /** The lead the emitter is aiming to hold, echoed so a console can judge depth. */
    targetDepth: number;
    /** False while the initial lead is still being built after a restart. */
    seeded: boolean;
    /** Height of the last block actually broadcast, or null before the first. */
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

    /** Blocks awaiting release, kept in ascending block-number order. */
    private readonly pending: IPendingBlockEmit[] = [];

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
     * @param release - Called with each payload when its slot arrives. Errors
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
        private readonly release: (payload: IBlockNewPayload) => void,
        private thresholds: IReleaseIntervalThresholds,
        private readonly maxDebtBlocks: number
    ) {}

    /**
     * Get the process-wide emitter, creating it on first use.
     *
     * Built lazily rather than at module load so importing this file — which
     * `system-monitor.service.ts` does purely to read metrics — never forces a
     * WebSocket service instance into existence before the server is ready.
     *
     * @returns The single emitter wired to the real WebSocket server.
     */
    public static getInstance(): BlockEmitter {
        if (!BlockEmitter.instance) {
            const websocket = WebSocketService.getInstance();

            BlockEmitter.instance = new BlockEmitter(
                payload => websocket.emit({ event: 'block:new', payload }),
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
    public enqueue(item: IPendingBlockEmit): void {
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
     * Broadcast a block immediately, ahead of anything the buffer is holding.
     *
     * Backfill and catch-up blocks take this path. The buffer is flushed first
     * so the feed cannot run backwards: a catch-up block is newer than what is
     * held, and releasing it before the held blocks would show a height that
     * then jumps back down.
     *
     * The carried deadline is cleared as well, so the first paced block after a
     * catch-up run starts a fresh cadence from itself rather than working off a
     * debt it did not cause. The seeded flag is deliberately left alone —
     * re-seeding here would stall the feed for a full lead's worth of time
     * every time the syncer recovered, which is exactly when a viewer is
     * already waiting.
     *
     * @param item - The block number and the event to broadcast for it.
     */
    public emitNow(item: IPendingBlockEmit): void {
        this.clearTimer();
        this.flushPending();
        this.emit(item);
        this.nextEmitAt = 0;
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
     * Release everything immediately and stop the clock.
     *
     * Called on shutdown so blocks already fetched and written still reach
     * connected clients instead of being dropped, and so a pending timer cannot
     * keep the process alive.
     */
    public stop(): void {
        this.clearTimer();
        this.flushPending();
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
     * Used by a catch-up run and by shutdown. Both are cases where the held
     * blocks are already late, so spacing them out would only add to the delay.
     */
    private flushPending(): void {
        if (this.pending.length === 0) {
            return;
        }

        this.flushes += 1;

        while (this.pending.length > 0) {
            this.emit(this.pending.shift() as IPendingBlockEmit);
        }
    }

    /**
     * Hand one block to the release function and record that it went out.
     *
     * The release function is wrapped because it reaches the WebSocket server,
     * and an error escaping from inside a timer callback would take down the
     * release clock with it — leaving the buffer filling and the feed frozen
     * with no obvious cause. Losing one broadcast is recoverable; losing the
     * clock is not.
     *
     * @param item - The block being released.
     */
    private emit(item: IPendingBlockEmit): void {
        try {
            this.release(item.payload);
            this.lastReleasedBlockNumber = item.blockNumber;
        } catch (error) {
            logger.error({ error, blockNumber: item.blockNumber }, 'Failed to broadcast block event');
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
