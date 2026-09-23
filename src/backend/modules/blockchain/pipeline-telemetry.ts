/**
 * @fileoverview In-memory record of what the block pipeline has done recently.
 *
 * The `/system` console used to read the pipeline from the sync state
 * document, which holds one block's timings, one error that the next healthy
 * tick erases, and no record of receipts at all. An operator could not tell
 * whether a stage was usually slow or slow once, could not see a block failure
 * that had already been cleared, and could not tell whether receipts, and so
 * decoded token transfers, were actually arriving.
 *
 * This class keeps a short rolling history instead: the last few hundred
 * prepared blocks with their receipt outcome and stage timings, the last few
 * dozen errors, and the latest scheduler tick. It lives in memory because it
 * is monitoring, not data: it resets on restart, costs no database write per
 * block, and a lost history loses nothing the pipeline depends on.
 *
 * The block pipeline calls the `record*` methods at the points where each fact
 * becomes known; the `/system` monitor reads `getSnapshot()`. Nothing in block
 * sync reads it back, so a fault here cannot change what sync does.
 *
 * @module backend/modules/blockchain/pipeline-telemetry
 */
import type { IPipelineBlockRecord, IPipelineError, IPipelineStageTiming, PipelineReceiptOutcome } from '@/types';

/** What block sync knows about a block once it has been prepared. */
export interface IPreparedBlockTelemetry {
    /** Block height. */
    blockNumber: number;
    /** The block's own header timestamp. */
    blockTimestamp: Date;
    /** Transactions the block held. */
    transactionCount: number;
    /** What happened when its receipts were requested. */
    receiptOutcome: PipelineReceiptOutcome;
    /** Contract events decoded from its receipts. */
    eventCount: number;
    /** Token transfers found, from logs or call data. */
    tokenTransferCount: number;
    /** Whether it went into the buffer (true) or was committed at once as catch-up work. */
    buffered: boolean;
    /** Per-stage timings in milliseconds; must include `prepare`. */
    timings: Record<string, number>;
}

/** What one scheduler tick decided. */
export interface IPipelineTickTelemetry {
    /** When the tick finished. */
    at: Date;
    /** The chain head it scheduled against. */
    headBlockNumber: number;
    /** True when TronGrid could not be reached and an older height was reused. */
    fromCache: boolean;
    /** Blocks it scheduled. */
    batchSize: number;
    /** Whether sync considered itself caught up, or null when no blocks were scheduled. */
    caughtUp: boolean | null;
}

/** A block height together with its header timestamp. */
export interface IPipelineHeightTelemetry {
    blockNumber: number;
    blockTimestamp: Date;
}

/** Counts of receipt outcomes over the recent window. */
export interface IReceiptOutcomeCounts {
    window: number;
    complete: number;
    partial: number;
    failed: number;
    disabled: number;
    empty: number;
}

/** Everything the recorder currently knows, for the `/system` monitor. */
export interface IPipelineTelemetrySnapshot {
    lastTick: IPipelineTickTelemetry | null;
    /** Highest block prepared since the process started. */
    lastFetched: IPipelineHeightTelemetry | null;
    /** Highest block committed since the process started. */
    lastCommitted: IPipelineHeightTelemetry | null;
    recentBlocks: IPipelineBlockRecord[];
    receipts: IReceiptOutcomeCounts;
    stages: IPipelineStageTiming[];
    errors: IPipelineError[];
    ingestBlocksPerMinute: number;
    commitBlocksPerMinute: number;
}

/** Options for sizing the recorder, supplied by tests. */
export interface IPipelineTelemetryOptions {
    /** Prepared blocks kept for timings and receipt counts. */
    blockWindow?: number;
    /** Errors kept. */
    errorWindow?: number;
    /** Blocks listed in `recentBlocks`. */
    recentBlockCount?: number;
    /** Clock, replaceable in tests. */
    now?: () => number;
}

/** One prepared block with the extra fields filled in when it is committed. */
interface IBlockEntry extends IPreparedBlockTelemetry {
    preparedAt: number;
    committedAt: number | null;
    commitTimings: Record<string, number> | null;
}

/** Stages of preparing a block, in pipeline order, as keyed in its timings. */
const PREPARE_STAGES = ['fetchBlock', 'getTrxPrice', 'fetchReceipts', 'processTransactions', 'calculateStats', 'prepare'];

/** Stages of committing a block, in pipeline order. */
const COMMIT_STAGES = ['bulkWriteTransactions', 'updateBlockModel', 'updateSyncState', 'commit'];

/** Window the per-minute rates are measured over. */
const RATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Pick a percentile from values already sorted ascending.
 *
 * Uses the nearest-rank method, which returns a value that actually occurred
 * rather than an interpolation, so a p95 of 180 ms means a block really took
 * 180 ms.
 *
 * @param sorted - Durations in ascending order.
 * @param fraction - The percentile as a fraction, such as 0.95.
 * @returns The value at that rank, or 0 for an empty list.
 */
function percentile(sorted: number[], fraction: number): number {
    let value = 0;

    if (sorted.length > 0) {
        const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
        value = sorted[rank];
    }

    return value;
}

/**
 * Classify what happened when a block's receipts were requested.
 *
 * Kept beside the recorder so the rule for "complete" matches the one block
 * sync uses for `receiptsFetched`: an empty block needs nothing, and any other
 * block needs a receipt for every transaction.
 *
 * @param transactionCount - Transactions the block held.
 * @param enabled - Whether the `fetchBlockReceipts` switch was on for this block.
 * @param receiptCount - Receipts that came back and matched a transaction.
 * @returns The outcome to record.
 */
export function resolveReceiptOutcome(transactionCount: number, enabled: boolean, receiptCount: number): PipelineReceiptOutcome {
    let outcome: PipelineReceiptOutcome;

    if (transactionCount === 0) {
        outcome = 'empty';
    } else if (!enabled) {
        outcome = 'disabled';
    } else if (receiptCount >= transactionCount) {
        outcome = 'complete';
    } else if (receiptCount === 0) {
        outcome = 'failed';
    } else {
        outcome = 'partial';
    }

    return outcome;
}

/**
 * Rolling, in-memory history of the block pipeline for the `/system` console.
 *
 * One instance per process, like `BlockEmitter`, because block sync and the
 * monitor must share it. The constructor stays public so a test can build its
 * own with a fake clock and small windows.
 */
export class PipelineTelemetry {
    private static instance: PipelineTelemetry | null = null;

    private readonly blockWindow: number;
    private readonly errorWindow: number;
    private readonly recentBlockCount: number;
    private readonly now: () => number;

    /** Prepared blocks, oldest first, capped at `blockWindow`. */
    private readonly blocks: IBlockEntry[] = [];
    /** Errors, oldest first, capped at `errorWindow`. */
    private readonly errors: IPipelineError[] = [];
    private lastTick: IPipelineTickTelemetry | null = null;
    private lastFetched: IPipelineHeightTelemetry | null = null;
    private lastCommitted: IPipelineHeightTelemetry | null = null;

    /**
     * @param options - Window sizes and a clock. Defaults suit production: 300
     *                  blocks is fifteen minutes of chain, enough for stable
     *                  percentiles without holding much memory.
     */
    constructor(options: IPipelineTelemetryOptions = {}) {
        this.blockWindow = options.blockWindow ?? 300;
        this.errorWindow = options.errorWindow ?? 50;
        this.recentBlockCount = options.recentBlockCount ?? 20;
        this.now = options.now ?? (() => Date.now());
    }

    /**
     * Return the process-wide recorder, creating it on first use.
     *
     * @returns The shared recorder block sync writes to and the monitor reads.
     */
    public static getInstance(): PipelineTelemetry {
        if (!PipelineTelemetry.instance) {
            PipelineTelemetry.instance = new PipelineTelemetry();
        }

        return PipelineTelemetry.instance;
    }

    /**
     * Record a block that has been prepared, before it is handed to the buffer.
     *
     * Called before the hand-off because a block that is not buffered is
     * committed straight away, and its commit must find this entry.
     *
     * @param block - What preparing the block found.
     */
    public recordPrepared(block: IPreparedBlockTelemetry): void {
        this.blocks.push({
            ...block,
            timings: { ...block.timings },
            preparedAt: this.now(),
            committedAt: null,
            commitTimings: null
        });
        if (this.blocks.length > this.blockWindow) {
            this.blocks.shift();
        }

        if (!this.lastFetched || block.blockNumber > this.lastFetched.blockNumber) {
            this.lastFetched = { blockNumber: block.blockNumber, blockTimestamp: block.blockTimestamp };
        }
    }

    /**
     * Record that a block was written.
     *
     * @param blockNumber - The block written.
     * @param timings - Its timings after the commit, which add the write stages
     *                  to the prepare stages.
     */
    public recordCommitted(blockNumber: number, timings: Record<string, number>): void {
        const committedAt = this.now();
        let entry: IBlockEntry | undefined;

        for (let index = this.blocks.length - 1; index >= 0; index -= 1) {
            if (this.blocks[index].blockNumber === blockNumber) {
                entry = this.blocks[index];
                break;
            }
        }

        if (entry) {
            entry.committedAt = committedAt;
            entry.commitTimings = { ...timings };
        }

        if (!this.lastCommitted || blockNumber > this.lastCommitted.blockNumber) {
            this.lastCommitted = {
                blockNumber,
                blockTimestamp: entry?.blockTimestamp ?? this.lastCommitted?.blockTimestamp ?? new Date(committedAt)
            };
        }
    }

    /**
     * Record a failure somewhere in the pipeline.
     *
     * @param error - Where it happened and what it said; `at` defaults to now.
     */
    public recordError(error: Omit<IPipelineError, 'at'> & { at?: string }): void {
        this.errors.push({ ...error, at: error.at ?? new Date(this.now()).toISOString() });
        if (this.errors.length > this.errorWindow) {
            this.errors.shift();
        }
    }

    /**
     * Record what the latest scheduler tick decided.
     *
     * @param tick - The head it used, whether that came from cache, and how many blocks it scheduled.
     */
    public recordTick(tick: IPipelineTickTelemetry): void {
        this.lastTick = { ...tick };
    }

    /**
     * Summarise the recorded history for the `/system` monitor.
     *
     * @returns Heights, recent blocks, receipt counts, stage percentiles,
     *          errors, and rates, all computed from the current window.
     */
    public getSnapshot(): IPipelineTelemetrySnapshot {
        const now = this.now();

        return {
            lastTick: this.lastTick ? { ...this.lastTick } : null,
            lastFetched: this.lastFetched ? { ...this.lastFetched } : null,
            lastCommitted: this.lastCommitted ? { ...this.lastCommitted } : null,
            recentBlocks: this.buildRecentBlocks(),
            receipts: this.countReceiptOutcomes(),
            stages: this.buildStageTimings(),
            errors: [...this.errors].reverse(),
            ingestBlocksPerMinute: this.ratePerMinute(entry => entry.preparedAt, now),
            commitBlocksPerMinute: this.ratePerMinute(entry => entry.committedAt, now)
        };
    }

    /**
     * Drop the shared instance so a test starts from nothing.
     *
     * @internal
     */
    public static resetForTesting(): void {
        PipelineTelemetry.instance = null;
    }

    /**
     * List the newest prepared blocks in the shape the console shows.
     *
     * @returns Up to `recentBlockCount` records, newest first.
     */
    private buildRecentBlocks(): IPipelineBlockRecord[] {
        return this.blocks.slice(-this.recentBlockCount).reverse().map(entry => ({
            blockNumber: entry.blockNumber,
            blockTimestamp: entry.blockTimestamp.toISOString(),
            transactionCount: entry.transactionCount,
            receiptOutcome: entry.receiptOutcome,
            eventCount: entry.eventCount,
            tokenTransferCount: entry.tokenTransferCount,
            preparedAt: new Date(entry.preparedAt).toISOString(),
            committedAt: entry.committedAt === null ? null : new Date(entry.committedAt).toISOString(),
            prepareMs: entry.timings.prepare ?? 0,
            commitMs: entry.commitTimings?.commit ?? null,
            buffered: entry.buffered
        }));
    }

    /**
     * Count receipt outcomes across the window.
     *
     * @returns One count per outcome, plus the window size they cover.
     */
    private countReceiptOutcomes(): IReceiptOutcomeCounts {
        const counts: IReceiptOutcomeCounts = { window: this.blocks.length, complete: 0, partial: 0, failed: 0, disabled: 0, empty: 0 };

        for (const entry of this.blocks) {
            counts[entry.receiptOutcome] += 1;
        }

        return counts;
    }

    /**
     * Compute the median, 95th percentile, and maximum of each stage.
     *
     * Prepare stages use every prepared block; commit stages use the blocks
     * committed so far. A stage with no samples is left out.
     *
     * @returns One entry per stage with samples, in pipeline order.
     */
    private buildStageTimings(): IPipelineStageTiming[] {
        const timings: IPipelineStageTiming[] = [];
        const phases: Array<{ phase: IPipelineStageTiming['phase']; stages: string[]; read: (entry: IBlockEntry) => Record<string, number> | null }> = [
            { phase: 'prepare', stages: PREPARE_STAGES, read: entry => entry.timings },
            { phase: 'commit', stages: COMMIT_STAGES, read: entry => entry.commitTimings }
        ];

        for (const { phase, stages, read } of phases) {
            for (const stage of stages) {
                const values = this.blocks
                    .map(entry => read(entry)?.[stage])
                    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
                    .sort((left, right) => left - right);

                if (values.length > 0) {
                    timings.push({
                        stage,
                        phase,
                        p50: percentile(values, 0.5),
                        p95: percentile(values, 0.95),
                        max: values[values.length - 1],
                        samples: values.length
                    });
                }
            }
        }

        return timings;
    }

    /**
     * Blocks per minute over the rate window, by one of the entry timestamps.
     *
     * Shortly after a restart the history covers less than the full window,
     * and dividing by the full window would report a healthy pipeline as slow.
     * The window is therefore shortened to the history actually held, but never
     * below one minute, so the first few blocks cannot produce a wild figure.
     *
     * @param read - Which timestamp to count: prepared or committed.
     * @param now - Current time.
     * @returns Blocks per minute, to one decimal place.
     */
    private ratePerMinute(read: (entry: IBlockEntry) => number | null, now: number): number {
        const oldest = this.blocks[0]?.preparedAt ?? now;
        const windowMs = Math.max(60_000, Math.min(RATE_WINDOW_MS, now - oldest));
        const cutoff = now - windowMs;
        const count = this.blocks.filter(entry => {
            const at = read(entry);
            return at !== null && at >= cutoff;
        }).length;

        return Number(((count * 60_000) / windowMs).toFixed(1));
    }
}
