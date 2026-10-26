/**
 * @fileoverview Finding blocks missing from the ClickHouse chain data and refetching them.
 *
 * ClickHouse receives each block once, as a side effect of the MongoDB commit.
 * A block that misses that hand-off is missing for good unless something looks
 * for it, and several things make a block miss it: the sync cursor moving past
 * a hole, fetch jobs left over from a previous process, a shutdown that runs out
 * of time while the writer still holds blocks, a full writer queue, or a failed
 * insert. Those failures happen in different places, so the repair works from
 * the result instead of the causes: it asks ClickHouse which blocks it does not
 * have.
 *
 * Each run is one local query for holes in `tron.block` and one for blocks the
 * writer recorded as partly written in `tron._ingest_gap`. A run that finds
 * nothing makes no TronGrid call at all. Each missing block costs two TronGrid
 * calls to refetch, one for the block and one for its receipts, on the queue
 * block sync shares, so repairs wait while sync is behind and are capped per run.
 * Repaired rows go through the same writer live blocks use, so they are written,
 * retried, and recorded as gaps on failure exactly the same way.
 *
 * The newest stretch of blocks is left alone: sync's own backfill may still be
 * filling it, and a block there may simply not have reached the writer yet.
 *
 * @module backend/modules/blockchain/chain-data/ChainDataReconciler
 */

import type { IClickHouseService, IPipelineChainData } from '@/types';
import { logger } from '../logger.js';
import { CHAIN_DATA_DATABASE, CHAIN_DATA_RETENTION_DAYS } from './buildChainDataSchema.js';
import type { IChainDataRows } from './buildChainDataRows.js';
import type { IChainDataSink } from './ChainDataWriter.js';

/**
 * Where a missing block's rows come from.
 *
 * `BlockchainService` satisfies this by refetching the block from TronGrid and
 * building its rows the way sync does. The reconciler depends on this one
 * method so a test can hand it a stub.
 */
export interface IChainDataBlockSource {
    /**
     * Fetch one block and build its ClickHouse rows without touching anything else.
     *
     * @param blockNumber - The block to fetch.
     * @returns The block's rows, or a failure marker the writer records as a gap.
     */
    fetchChainDataRows(blockNumber: number): Promise<IChainDataRows>;
}

/**
 * Where repaired rows are written: the same writer live blocks use, plus a way
 * to wait for it.
 *
 * Waiting between small groups of repairs keeps them from filling the writer's
 * queue, which also holds live blocks and refuses new ones when full.
 */
export interface IChainDataRepairSink extends IChainDataSink {
    /**
     * Resolve once every block handed over so far is written or recorded as a gap.
     *
     * @returns Resolves when the writer is idle.
     */
    drain(): Promise<void>;
}

/** How the reconciler decides what to repair and how much. */
export interface IChainDataReconcilerOptions {
    /**
     * Whether block sync is caught up. Repairs share the TronGrid queue with
     * sync, so they wait while sync is behind; the check still runs and reports.
     */
    isSyncCaughtUp: () => boolean;
    /** Days back from now the check covers. Defaults to one less than the retention, so nothing is repaired just before it expires. */
    windowDays?: number;
    /** Newest blocks left to sync's own backfill rather than repaired. */
    settleBlocks?: number;
    /** Most blocks refetched in one run, which bounds the TronGrid calls a run makes. */
    maxRepairsPerRun?: number;
    /** Blocks handed to the writer before waiting for it to finish them. */
    repairChunkSize?: number;
    /** Times one block is tried before this process stops trying it. */
    maxAttemptsPerBlock?: number;
    /** Refetch failures in a row after which the run stops, since TronGrid is probably failing. */
    maxConsecutiveFailures?: number;
    /** Time after which a run starts no new repair, so it ends before the next run is due. */
    timeBudgetMs?: number;
    /** The clock, injectable so a test can control the snapshot's times. */
    now?: () => Date;
}

/** A run of consecutive missing blocks, as the hole query reports it. */
interface IMissingRange {
    /** First missing block. */
    start: number;
    /** Last missing block. */
    end: number;
    /** Whether the hole ends within the last 24 hours. */
    recent: boolean;
}

/** What the two checks found, before any repair. */
interface IChainDataFindings {
    /** Holes between stored blocks, newest first. */
    ranges: IMissingRange[];
    /** Blocks stored only in part, newest first. */
    partial: number[];
}

/**
 * Blocks left alone at the top of the stored range. About ten minutes of
 * chain, which comfortably covers the writer's queue and sync's own backfill
 * window, so the repair never races either for a block that is on its way.
 */
const DEFAULT_SETTLE_BLOCKS = 200;

/**
 * Blocks refetched per run, when the caller sets no limit. Two calls each at the
 * queue's 200 ms spacing is about forty seconds of the shared queue per run,
 * while caught-up sync needs well under one call a second. Over a day that
 * refills about 28,800 blocks, roughly a day of chain.
 */
const DEFAULT_MAX_REPAIRS = 100;

/** Blocks handed to the writer between waits, when the caller sets no size. */
const DEFAULT_CHUNK_SIZE = 10;

/** Tries per block per process, so a block TronGrid keeps refusing does not cost two calls every run forever. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Failures in a row before a run gives up, when the caller sets no limit. */
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

/** Run time after which no new repair starts, when the caller sets no budget. Under the five-minute schedule. */
const DEFAULT_TIME_BUDGET_MS = 4 * 60 * 1000;

/** Most rows either query returns, which bounds memory if ClickHouse lost a long stretch. */
const QUERY_LIMIT = 10_000;

/**
 * Holes between stored blocks. Each stored block is compared with the one
 * before it; a difference above one is a hole. Grouped by block number first,
 * because a block written twice keeps two rows until parts merge.
 */
const HOLES_SQL = `
SELECT
    toUInt64(previous + 1) AS gap_start,
    toUInt64(block_number - 1) AS gap_end,
    after_timestamp >= now64(3) - INTERVAL 24 HOUR AS recent
FROM (
    SELECT
        block_number,
        block_timestamp AS after_timestamp,
        lagInFrame(block_number, 1, 0) OVER (ORDER BY block_number ASC ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS previous
    FROM (
        SELECT block_number, any(timestamp) AS block_timestamp
        FROM ${CHAIN_DATA_DATABASE}.block
        WHERE timestamp >= now64(3) - INTERVAL {windowDays:UInt32} DAY
        GROUP BY block_number
    )
)
WHERE previous > 0
  AND block_number - previous > 1
  AND block_number <= {ceiling:UInt64}
ORDER BY gap_start DESC
LIMIT ${QUERY_LIMIT}`;

/**
 * Blocks stored only in part: the writer recorded a failure for the block after
 * its block row was last written, so some of its tables may be missing rows.
 * A block rewritten after the failure has a newer `_ingested_at` and drops out.
 */
const PARTIAL_SQL = `
SELECT gap.block_number AS block_number
FROM (
    SELECT block_number, max(recorded_at) AS recorded_at
    FROM ${CHAIN_DATA_DATABASE}._ingest_gap
    WHERE recorded_at >= now64(3) - INTERVAL {windowDays:UInt32} DAY
    GROUP BY block_number
) AS gap
INNER JOIN (
    SELECT block_number, max(_ingested_at) AS ingested_at
    FROM ${CHAIN_DATA_DATABASE}.block
    WHERE timestamp >= now64(3) - INTERVAL {windowDays:UInt32} DAY
    GROUP BY block_number
) AS stored ON gap.block_number = stored.block_number
WHERE stored.ingested_at < gap.recorded_at
  AND gap.block_number <= {ceiling:UInt64}
ORDER BY block_number DESC
LIMIT ${QUERY_LIMIT}`;

/** The newest stored block, which sets the top of the checked range. */
const NEWEST_SQL = `SELECT max(block_number) AS newest FROM ${CHAIN_DATA_DATABASE}.block`;

/**
 * Which of the blocks just handed to the writer ClickHouse actually holds.
 *
 * The same test the partial-block check uses, applied to a named list: a block
 * counts only when its newest stored row is newer than the newest gap recorded
 * for it, so a block the writer refused or failed to insert during this very
 * chunk is not credited. Written as one grouped union rather than a join so the
 * comparison does not depend on how an unmatched side is filled.
 */
const CONFIRM_SQL = `
SELECT block_number
FROM (
    SELECT block_number, max(_ingested_at) AS written_at, toDateTime64(0, 3, 'UTC') AS gapped_at
    FROM ${CHAIN_DATA_DATABASE}.block
    WHERE block_number IN ({blocks:Array(UInt64)})
    GROUP BY block_number
    UNION ALL
    SELECT block_number, toDateTime64(0, 3, 'UTC') AS written_at, max(recorded_at) AS gapped_at
    FROM ${CHAIN_DATA_DATABASE}._ingest_gap
    WHERE block_number IN ({blocks:Array(UInt64)})
    GROUP BY block_number
)
GROUP BY block_number
HAVING max(written_at) > max(gapped_at)`;

/**
 * Finds blocks missing from the `tron` tables and refetches them.
 *
 * A utility rather than a singleton service: `BlockchainService` constructs the
 * one instance it needs alongside the chain data writer, and a test builds
 * another against fakes.
 */
export class ChainDataReconciler {
    /** What the last run found and did, for the `/system` Pipeline tab. */
    private snapshot: IPipelineChainData;

    /**
     * Times each block has been tried in this process. Rebuilt every run to
     * hold only blocks still missing, so it cannot grow without bound.
     */
    private attempts = new Map<number, number>();

    private readonly windowDays: number;
    private readonly settleBlocks: number;
    private readonly maxRepairsPerRun: number;
    private readonly repairChunkSize: number;
    private readonly maxAttemptsPerBlock: number;
    private readonly maxConsecutiveFailures: number;
    private readonly timeBudgetMs: number;
    private readonly now: () => Date;

    /**
     * Build a reconciler with every limit resolved once. Nothing touches
     * ClickHouse or TronGrid until the first run.
     *
     * @param clickhouse - The ClickHouse service the checks read from.
     * @param source - Where a missing block's rows are refetched from.
     * @param sink - The writer repaired rows are handed to, the same one live blocks use.
     * @param options - When repairs may run and the limits described on
     *                  {@link IChainDataReconcilerOptions}.
     */
    constructor(
        private readonly clickhouse: IClickHouseService,
        private readonly source: IChainDataBlockSource,
        private readonly sink: IChainDataRepairSink,
        private readonly options: IChainDataReconcilerOptions
    ) {
        this.windowDays = Math.max(1, options.windowDays ?? CHAIN_DATA_RETENTION_DAYS - 1);
        this.settleBlocks = Math.max(0, options.settleBlocks ?? DEFAULT_SETTLE_BLOCKS);
        this.maxRepairsPerRun = Math.max(0, options.maxRepairsPerRun ?? DEFAULT_MAX_REPAIRS);
        this.repairChunkSize = Math.max(1, options.repairChunkSize ?? DEFAULT_CHUNK_SIZE);
        this.maxAttemptsPerBlock = Math.max(1, options.maxAttemptsPerBlock ?? DEFAULT_MAX_ATTEMPTS);
        this.maxConsecutiveFailures = Math.max(1, options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES);
        this.timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
        this.now = options.now ?? (() => new Date());
        this.snapshot = {
            status: 'never-run',
            message: null,
            lastRunAt: null,
            lastRunDurationMs: null,
            windowDays: this.windowDays,
            missingBlocks: 0,
            partialBlocks: 0,
            missingLast24h: 0,
            oldestMissing: null,
            newestMissing: null,
            repaired: 0,
            repairFailures: 0,
            remaining: 0,
            consecutiveRunsWithGaps: 0
        };
    }

    /**
     * What the last run found and did.
     *
     * @returns A copy of the snapshot, so a caller cannot change what the next
     *          reader sees.
     */
    public getSnapshot(): IPipelineChainData {
        return { ...this.snapshot };
    }

    /**
     * Check the chain data for missing blocks and refetch as many as this run allows.
     *
     * A failed check is recorded on the snapshot and then thrown, so the
     * scheduler records the run as failed and the next run tries again. A
     * failed refetch is not thrown: the block stays missing and the next run
     * finds it again.
     *
     * @returns What the run found and did, as the Pipeline tab will show it.
     */
    public async run(): Promise<IPipelineChainData> {
        const startedAt = this.now();
        const consecutive = this.snapshot.consecutiveRunsWithGaps;

        try {
            const findings = await this.findMissing();
            const missingBlocks = findings.ranges.reduce((total, range) => total + range.end - range.start + 1, 0);
            const missingLast24h = findings.ranges
                .filter(range => range.recent)
                .reduce((total, range) => total + range.end - range.start + 1, 0);
            const needing = missingBlocks + findings.partial.length;
            const extremes = this.findExtremes(findings);

            const base: IPipelineChainData = {
                ...this.snapshot,
                message: null,
                lastRunAt: startedAt.toISOString(),
                missingBlocks,
                partialBlocks: findings.partial.length,
                missingLast24h,
                oldestMissing: extremes.oldest,
                newestMissing: extremes.newest,
                repaired: 0,
                repairFailures: 0,
                remaining: needing,
                consecutiveRunsWithGaps: needing > 0 ? consecutive + 1 : 0
            };

            if (needing === 0) {
                this.attempts.clear();
                this.snapshot = { ...base, status: 'clean' };
            } else if (!this.options.isSyncCaughtUp()) {
                this.snapshot = {
                    ...base,
                    status: 'skipped',
                    message: 'Block sync is behind, so missing blocks were counted but not refetched; repairs share the TronGrid queue with sync.'
                };
            } else {
                const candidates = this.selectCandidates(findings);
                const outcome = await this.repair(candidates, startedAt.getTime());
                const remaining = Math.max(0, needing - outcome.repaired);
                this.snapshot = {
                    ...base,
                    status: remaining === 0 ? 'repaired' : 'incomplete',
                    message: outcome.stopReason ?? this.describeRemainder(remaining, candidates.length),
                    repaired: outcome.repaired,
                    repairFailures: outcome.failures,
                    remaining
                };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.snapshot = {
                ...this.snapshot,
                status: 'failed',
                message: `The chain data check failed: ${message}`,
                lastRunAt: startedAt.toISOString()
            };
            this.snapshot.lastRunDurationMs = this.now().getTime() - startedAt.getTime();
            logger.error({ error }, 'Chain data repair run failed; the next run tries again');
            throw error;
        }

        this.snapshot.lastRunDurationMs = this.now().getTime() - startedAt.getTime();
        this.report();
        return this.getSnapshot();
    }

    /**
     * Ask ClickHouse which blocks are missing or stored only in part.
     *
     * The top of the checked range is the newest stored block minus the settle
     * margin, so the newest stretch is left to sync. An empty table has nothing
     * to compare against, so it reports nothing missing.
     *
     * @returns Holes and partly written blocks, newest first.
     */
    private async findMissing(): Promise<IChainDataFindings> {
        let findings: IChainDataFindings = { ranges: [], partial: [] };
        const newestRows = await this.clickhouse.query<{ newest: string | number }>(NEWEST_SQL);
        const newest = Number(newestRows[0]?.newest ?? 0);
        const ceiling = newest - this.settleBlocks;

        if (Number.isFinite(newest) && newest > 0 && ceiling > 0) {
            const params = { windowDays: this.windowDays, ceiling };
            const holes = await this.clickhouse.query<{ gap_start: string | number; gap_end: string | number; recent: number | boolean }>(HOLES_SQL, params);
            const partial = await this.clickhouse.query<{ block_number: string | number }>(PARTIAL_SQL, params);
            findings = {
                ranges: holes.map(row => ({
                    start: Number(row.gap_start),
                    end: Number(row.gap_end),
                    recent: Boolean(Number(row.recent))
                })),
                partial: partial.map(row => Number(row.block_number))
            };
        }

        return findings;
    }

    /**
     * The lowest and highest block needing repair, for the snapshot.
     *
     * @param findings - What the checks found.
     * @returns The two extremes, or nulls when nothing is missing.
     */
    private findExtremes(findings: IChainDataFindings): { oldest: number | null; newest: number | null } {
        const ends = [
            ...findings.ranges.flatMap(range => [range.start, range.end]),
            ...findings.partial
        ];
        return {
            oldest: ends.length > 0 ? Math.min(...ends) : null,
            newest: ends.length > 0 ? Math.max(...ends) : null
        };
    }

    /**
     * Choose the blocks this run refetches, newest first.
     *
     * Newest first because recent history is what is read most, and the
     * oldest days are closest to expiring anyway. Blocks already tried the
     * maximum number of times in this process are skipped, and the attempt
     * record is trimmed to blocks still missing.
     *
     * @param findings - What the checks found.
     * @returns At most the per-run limit of block numbers.
     */
    private selectCandidates(findings: IChainDataFindings): number[] {
        const missing: number[] = [];
        const seen = new Set<number>();

        /**
         * Add one block once, stopping at the per-run limit.
         *
         * @param blockNumber - A block needing repair.
         */
        const add = (blockNumber: number): void => {
            if (!seen.has(blockNumber)) {
                seen.add(blockNumber);
                missing.push(blockNumber);
            }
        };

        for (const range of findings.ranges) {
            for (let blockNumber = range.end; blockNumber >= range.start && seen.size < QUERY_LIMIT; blockNumber -= 1) {
                add(blockNumber);
            }
        }
        findings.partial.forEach(add);

        const trimmed = new Map<number, number>();
        for (const blockNumber of missing) {
            const tried = this.attempts.get(blockNumber);
            if (tried !== undefined) {
                trimmed.set(blockNumber, tried);
            }
        }
        this.attempts = trimmed;

        return missing
            .sort((left, right) => right - left)
            .filter(blockNumber => (this.attempts.get(blockNumber) ?? 0) < this.maxAttemptsPerBlock)
            .slice(0, this.maxRepairsPerRun);
    }

    /**
     * Refetch the chosen blocks and hand their rows to the writer.
     *
     * Blocks go to the writer in small groups, waiting for each group to be
     * written before the next, so repairs never fill the queue live blocks need.
     * The run stops early when TronGrid fails several times in a row or the
     * time budget runs out, and says which.
     *
     * @param candidates - Blocks to refetch, newest first.
     * @param startedAtMs - When the run started, for the time budget.
     * @returns How many ClickHouse confirmed it now holds, how many failed, and
     *          why the run stopped early, if it did.
     */
    private async repair(
        candidates: number[],
        startedAtMs: number
    ): Promise<{ repaired: number; failures: number; stopReason: string | null }> {
        let repaired = 0;
        let failures = 0;
        let consecutiveFailures = 0;
        let stopReason: string | null = null;

        for (let index = 0; index < candidates.length && stopReason === null; index += this.repairChunkSize) {
            const submitted: number[] = [];
            for (const blockNumber of candidates.slice(index, index + this.repairChunkSize)) {
                if (stopReason !== null) {
                    break;
                }
                if (this.now().getTime() - startedAtMs >= this.timeBudgetMs) {
                    stopReason = 'The run reached its time budget; the next run continues.';
                    break;
                }

                this.attempts.set(blockNumber, (this.attempts.get(blockNumber) ?? 0) + 1);
                try {
                    const rows = await this.source.fetchChainDataRows(blockNumber);
                    this.sink.submit(rows);
                    consecutiveFailures = 0;
                    if (rows.failure === undefined) {
                        submitted.push(blockNumber);
                    } else {
                        failures += 1;
                    }
                } catch (error) {
                    failures += 1;
                    consecutiveFailures += 1;
                    logger.warn({ error, blockNumber }, 'Could not refetch a block missing from the chain data; the next run tries again');
                    if (consecutiveFailures >= this.maxConsecutiveFailures) {
                        stopReason = `TronGrid failed ${consecutiveFailures} refetches in a row, so the run stopped; the next run tries again.`;
                    }
                }
            }
            await this.sink.drain();
            const written = await this.confirmWritten(submitted);
            repaired += written;
            failures += submitted.length - written;
        }

        return { repaired, failures, stopReason };
    }

    /**
     * Ask ClickHouse which of the blocks just handed over are really stored.
     *
     * Handing rows to the writer is not the same as writing them: the writer
     * refuses a block when its queue is full and records a gap instead, and an
     * insert that fails every attempt becomes a gap too. `drain()` resolves in
     * both cases, so counting a submission as a repair let a run report
     * `repaired` with nothing remaining while every block was still missing,
     * which is the state the health banner needs to see. The writer's inserts
     * finish before the drain returns, so a block it wrote is already queryable,
     * and this costs one local query per chunk.
     *
     * A confirmation query that fails leaves its blocks uncounted, because an
     * unconfirmed repair has to read as a repair that did not happen. The next
     * run finds them again either way.
     *
     * @param blockNumbers - Blocks handed to the writer in this chunk.
     * @returns How many of them ClickHouse now holds.
     */
    private async confirmWritten(blockNumbers: number[]): Promise<number> {
        let written = 0;

        if (blockNumbers.length > 0) {
            try {
                const rows = await this.clickhouse.query<{ block_number: string | number }>(CONFIRM_SQL, { blocks: blockNumbers });
                written = rows.length;
            } catch (error) {
                logger.warn(
                    { error, blockCount: blockNumbers.length },
                    'Could not confirm which repaired blocks reached ClickHouse; they are counted as still missing'
                );
            }
        }

        return written;
    }

    /**
     * Say why blocks remain after a run that was not cut short.
     *
     * Without this an `incomplete` run would carry no explanation, and the two
     * causes call for different responses: the per-run limit clears itself over
     * the next runs, while blocks this process has given up on need an operator.
     *
     * @param remaining - Blocks still needing repair after the run.
     * @param attempted - Blocks the run chose to refetch.
     * @returns The explanation, or null when nothing remains.
     */
    private describeRemainder(remaining: number, attempted: number): string | null {
        let message: string | null = null;

        if (remaining > 0 && attempted >= this.maxRepairsPerRun) {
            message = `A run refetches at most ${this.maxRepairsPerRun} blocks; the next runs continue with the rest.`;
        } else if (remaining > 0) {
            message = `Some blocks failed ${this.maxAttemptsPerBlock} refetches and are no longer tried until the backend restarts; the warnings logged for each refetch say why.`;
        }

        return message;
    }

    /**
     * Log what the run found, raising the level when a gap has outlasted a run.
     *
     * A gap seen once may be a block that went missing moments before the
     * check. A gap still there on the next run means the repair is not keeping
     * up, or cannot fix it, and an operator needs to know, so that is logged
     * as an error. A clean run is a debug line, so a healthy deployment's logs
     * stay quiet.
     */
    private report(): void {
        const snapshot = this.snapshot;
        const context = {
            status: snapshot.status,
            missingBlocks: snapshot.missingBlocks,
            partialBlocks: snapshot.partialBlocks,
            missingLast24h: snapshot.missingLast24h,
            oldestMissing: snapshot.oldestMissing,
            newestMissing: snapshot.newestMissing,
            repaired: snapshot.repaired,
            repairFailures: snapshot.repairFailures,
            remaining: snapshot.remaining,
            consecutiveRunsWithGaps: snapshot.consecutiveRunsWithGaps,
            durationMs: snapshot.lastRunDurationMs,
            reason: snapshot.message
        };

        if (snapshot.status === 'clean') {
            logger.debug(context, 'Chain data repair run found nothing missing');
        } else if (snapshot.remaining > 0 && snapshot.consecutiveRunsWithGaps >= 2) {
            logger.error(context, 'Blocks are still missing from the ClickHouse chain data after more than one repair run');
        } else {
            logger.info(context, 'Chain data repair run finished');
        }
    }
}
