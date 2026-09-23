import type { IObserverStats } from '../observer/IObserverStats.js';
import type { IPipelineBlockRecord } from './IPipelineBlockRecord.js';
import type { IPipelineError } from './IPipelineError.js';
import type { IPipelineHealth } from './IPipelineHealth.js';
import type { IPipelineStageTiming } from './IPipelineStageTiming.js';
import type { PipelineReleaseMode } from './PipelineReleaseMode.js';
import type { PipelineTone } from './PipelineTone.js';

/**
 * Everything the `/system` Pipeline tab shows about block ingestion, in one
 * payload from `GET /api/admin/system/blockchain/pipeline`.
 *
 * One request instead of four keeps the console inside the admin rate limit
 * at a faster poll, and means every figure on screen was read at the same
 * moment. The payload is built from in-memory state and the sync state
 * document only; it never calls TronGrid, so reading it does not compete with
 * block sync for the shared request queue.
 *
 * Block pipeline vocabulary used below: a block is **fetched** when sync has
 * pulled and prepared it, **buffered** while it waits in the emitter for its
 * release slot, and **committed** once it is written and announced.
 */
export interface IPipelineStatus {
    /** When the payload was built, as an ISO string. */
    generatedAt: string;

    /** Overall state and the reasons behind it. */
    health: IPipelineHealth;

    /** Configured values the figures below are judged against. */
    config: {
        /** Seconds between TRON blocks. */
        blockIntervalSeconds: number;
        /** Lag at which sync stops buffering blocks and treats them as catch-up work. */
        backfillEntryBlocks: number;
        /** Lag at which sync resumes buffering. */
        liveChainThrottleBlocks: number;
        /** Lead the buffer aims to hold. */
        emitBufferTargetDepth: number;
        /** Depth above which the buffer drains quickly. */
        emitBufferCatchupDepth: number;
        /** Depth above which blocks are released with no wait. */
        emitBufferMaxDepth: number;
    };

    /**
     * Where each part of the pipeline has reached. Lags are measured from each
     * block's own header timestamp, the same way sync decides whether a block
     * is live work, so they need no call to the chain head.
     */
    heights: {
        /** The chain head as the last sync tick saw it. */
        head: {
            blockNumber: number | null;
            /** When that tick read it, as an ISO string. */
            observedAt: string | null;
            /** True when the tick could not reach TronGrid and reused an older height. */
            fromCache: boolean;
        };
        /** The newest block sync has fetched and prepared. */
        fetched: {
            blockNumber: number | null;
            blockTimestamp: string | null;
            /** How many blocks old it is. This is ingestion lag. */
            lagBlocks: number | null;
            lagTone: PipelineTone;
        };
        /** Blocks prepared and waiting for their release slot. */
        buffered: number;
        /** The newest block written and announced. */
        committed: {
            blockNumber: number | null;
            blockTimestamp: string | null;
            /** How many blocks old it is. This is the delay a viewer sees. */
            lagBlocks: number | null;
            lagTone: PipelineTone;
        };
        /** The sync cursor stored in MongoDB. */
        cursor: number | null;
    };

    /** The scheduler tick that decides which blocks to fetch. */
    sync: {
        /** `'live'` while blocks go through the buffer, `'catch-up'` while sync is behind and writes straight away. */
        mode: 'live' | 'catch-up' | 'unknown';
        /** The `blockchain:sync` scheduler job. */
        job: {
            registered: boolean;
            enabled: boolean;
            schedule: string | null;
        };
        /** When the last tick finished, as an ISO string. */
        lastTickAt: string | null;
        /** Blocks the last tick scheduled. */
        lastBatchSize: number | null;
        /** Blocks prepared per minute over the last five minutes. */
        ingestBlocksPerMinute: number;
        /** Blocks the chain produces per minute. */
        networkBlocksPerMinute: number;
        /** The latest error in the sync state document, if one is standing. */
        standingError: string | null;
    };

    /** The emitter that holds prepared blocks and releases them on the chain's cadence. */
    buffer: {
        depth: number;
        targetDepth: number;
        seeded: boolean;
        releaseMode: PipelineReleaseMode;
        /** Spacing chosen for the most recent release, in milliseconds. */
        lastIntervalMs: number | null;
        /** Times the buffer ran out of lead since the process started. */
        underruns: number;
        /** Blocks released while it had no lead. */
        underrunBlocks: number;
        /** When the most recent underrun began, as an ISO string. */
        lastUnderrunAt: string | null;
        /** Times a catch-up run flushed the buffer. */
        flushes: number;
    };

    /** Writing released blocks. */
    commit: {
        /** Blocks given a slot and not yet written. */
        queued: number;
        /** Commits that failed since the process started. */
        failures: number;
        /** Blocks committed per minute over the last five minutes. */
        commitBlocksPerMinute: number;
    };

    /** Transaction receipts, which carry energy, bandwidth, and event logs. */
    receipts: {
        /** Whether the `fetchBlockReceipts` switch is on. */
        enabled: boolean;
        /** Recent prepared blocks the counts below cover. */
        window: number;
        complete: number;
        partial: number;
        failed: number;
        disabled: number;
        empty: number;
        /** Complete or empty blocks as a share of the blocks receipts were requested for, so `disabled` blocks are excluded; null when receipts were requested for none. */
        coveragePercent: number | null;
        coverageTone: PipelineTone;
    };

    /** Median and 95th percentile per stage over recent blocks, in pipeline order. */
    stages: IPipelineStageTiming[];

    /** Blocks waiting to be fetched again after a failure or a gap. */
    backfill: {
        size: number;
        oldest: number | null;
        newest: number | null;
        /** The first few block numbers, oldest first. */
        sample: number[];
    };

    /** Recent failures, newest first. */
    errors: IPipelineError[];

    /** Recent prepared blocks, newest first. */
    recentBlocks: IPipelineBlockRecord[];

    /** Every registered observer with its statistics. */
    observers: IObserverStats[];
}
