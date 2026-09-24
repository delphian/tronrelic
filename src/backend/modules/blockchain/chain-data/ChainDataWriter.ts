/**
 * @fileoverview Writing committed blocks into the ClickHouse `tron` database.
 *
 * The block committer hands each committed block's rows here and moves on. This
 * class makes sure the tables exist, writes the rows, records how far it has
 * got, and records every block it could not write as a gap. Nothing it does can
 * slow or stop block sync: submissions return at once, writes run on a loop of
 * their own, and every failure is caught and recorded rather than thrown.
 *
 * Blocks are written in batches. While one write is in flight, later blocks
 * wait, and the next write takes everything that waited — one insert per table
 * for all of them. At the chain's pace that is one block per write, but after a
 * restart or a backfill sync commits blocks far faster than every three
 * seconds, and writing those one at a time would fall behind and overflow the
 * queue. ClickHouse also prefers fewer, larger inserts.
 *
 * Every ClickHouse call is retried a few times through the shared `retry()`
 * helper, with a doubling, jittered delay, before the writer gives up on it,
 * because the usual failure is brief: a restart, a
 * network blip, or a connection pool that is busy for a moment. Retrying a data
 * insert is safe even when an earlier attempt did commit, because every data
 * table is a `ReplacingMergeTree` keyed on the row's natural identity, so a
 * repeated row collapses into one when parts merge. A call that fails every
 * attempt is logged at `fatal`, since at that point something is missing from
 * ClickHouse and an operator needs to know.
 *
 * Gaps are the part worth understanding. Chain data is only as useful as the
 * certainty that it is complete, and a block that failed to write looks exactly
 * like a block with no activity in every other table. `tron._ingest_gap` is what
 * tells the two apart, so every path where the writer itself loses a block
 * writes to it.
 *
 * One loss is outside the writer's reach, and a consumer reading the gap table
 * has to know about it. A block is handed over into an in-memory queue, so a
 * process killed before its rows reach ClickHouse — a crash, or a shutdown
 * whose drain timed out — leaves the block committed in MongoDB, missing from
 * these tables, and absent from `_ingest_gap`. Nothing fetches it again,
 * because the missing-block scan only looks for a block document and MongoDB
 * already has one. Closing that needs a startup check comparing
 * `_ingest_state` with the MongoDB cursor, which this writer does not do
 * today. The cost is bounded because this is a short-term copy rather than a
 * system of record.
 *
 * @module backend/modules/blockchain/chain-data/ChainDataWriter
 */

import type { IClickHouseInsertOptions, IClickHouseService } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import { retry } from '../../../lib/retry.js';
import { logger } from '../logger.js';
import { buildChainDataSchema, CHAIN_DATA_DATABASE, CHAIN_DATA_RETENTION_DAYS } from './buildChainDataSchema.js';
import type { ChainDataRow, IChainDataRows } from './buildChainDataRows.js';

/**
 * Where committed blocks' chain data goes.
 *
 * The committer depends on this rather than on {@link ChainDataWriter} so a test
 * can hand it a spy, and so a deployment without ClickHouse simply has no sink.
 */
export interface IChainDataSink {
    /**
     * Accept one committed block's rows and return immediately.
     *
     * @param rows - The rows the block contributes to each table.
     */
    submit(rows: IChainDataRows): void;
}

/** How the writer is configured. */
export interface IChainDataWriterOptions {
    /** The block source, stamped on every row as `_provider`, such as `trongrid`. */
    provider: string;
    /** Days of data each table keeps when the writer creates it. */
    retentionDays?: number;
    /**
     * Blocks allowed to be waiting or in flight before new ones are refused and
     * recorded as gaps. Bounds memory if ClickHouse stalls, since every waiting
     * block holds all of its rows.
     */
    maxQueued?: number;
    /** Most blocks combined into one write. */
    maxBatch?: number;
    /** How long to wait after a failed schema attempt before trying again. */
    schemaRetryMs?: number;
    /** How many times each ClickHouse call is tried before the writer gives up on it. */
    maxAttempts?: number;
    /**
     * The base wait before the first retry. The base doubles for each later
     * retry, and `retry()` jitters every actual wait to between half and all of it.
     */
    retryDelayMs?: number;
    /** The clock, injectable so a test can control `_ingested_at` and `recorded_at`. */
    now?: () => Date;
    /** Waits between retries, passed to `retry()`, so a test does not sit through real delays. */
    sleep?: (ms: number) => Promise<void>;
}

/** Options for {@link ChainDataWriter.drain}. */
export interface IChainDataDrainOptions {
    /**
     * True when the process is about to exit. The writer then stops retrying,
     * so every block it holds ends as written or as a gap within the shutdown
     * timeout, instead of being cut off in the middle of a retry delay with
     * neither.
     */
    shuttingDown?: boolean;
}

/** What one retried ClickHouse call came to. */
interface IWriteOutcome {
    /** Whether some attempt succeeded. */
    succeeded: boolean;
    /** The last attempt's error when every attempt failed; undefined on success. */
    error?: unknown;
}

/**
 * Blocks allowed to wait before new ones are refused, when the caller sets no
 * limit. Batching drains a backlog far faster than sync can fetch one, so the
 * queue only fills when ClickHouse itself has stalled, and then this bounds the
 * memory the waiting rows hold.
 */
const DEFAULT_MAX_QUEUED = 100;

/** Most blocks per write, when the caller sets no limit. */
const DEFAULT_MAX_BATCH = 50;

/** How long to wait between schema attempts, when the caller sets no delay. */
const DEFAULT_SCHEMA_RETRY_MS = 60_000;

/**
 * Tries per ClickHouse call, when the caller sets no limit. Four tries with the
 * default delay wait at most 0.5, 1, and 2 seconds between them, and jitter
 * shortens each wait by up to half, so a call gives up after between about 1.75
 * and 3.5 seconds. That rides out a brief outage while staying close to one
 * block time, so the queue behind it does not build up.
 */
const DEFAULT_MAX_ATTEMPTS = 4;

/** The wait before the first retry, when the caller sets no delay. */
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * How every insert the writer makes is run: synchronously, skipping the
 * server's async-insert buffer.
 *
 * The writer already batches its rows, so the buffer adds nothing. Waiting for
 * the buffer to be written would hold one of the shared client's ten pooled
 * connections for up to a few hundred milliseconds per table, and a batch
 * touches many tables, so every other ClickHouse caller would spend that time
 * queued behind it. A synchronous insert returns as soon as its rows are stored
 * and throws if they were not, which is the durability the gap record depends on.
 */
const INSERT_OPTIONS: IClickHouseInsertOptions = { synchronous: true };

/** The writer's name in `tron._ingest_state`, one row per writer. */
const WRITER_NAME = 'block-sync';

/** Longest reason stored on a gap, so one enormous error cannot bloat the table. */
const MAX_GAP_REASON_LENGTH = 1000;

/**
 * Most lost blocks remembered while the gap table does not exist yet. About two
 * days of blocks at the chain's pace, which bounds the memory an unreachable
 * ClickHouse can cost while still covering an ordinary outage.
 */
const MAX_DEFERRED_GAPS = 60_000;

/** One block lost before the gap table existed, held until it can be recorded. */
interface IDeferredGap {
    /** The block missing from the tables. */
    blockNumber: number;
    /** Why it is missing, as it will be written to `_ingest_gap`. */
    reason: string;
}

/**
 * Describe a list of block numbers for a log line without writing all of them.
 *
 * A batch can hold 50 blocks, and a log entry listing every one of them is hard
 * to read. The first block, the last block, and the count say which stretch of
 * the chain is affected.
 *
 * @param blockNumbers - The blocks the log line is about, in order.
 * @returns The first and last block and how many there are.
 */
function describeBlocks(blockNumbers: number[]): { firstBlock: number | undefined; lastBlock: number | undefined; blockCount: number } {
    return {
        firstBlock: blockNumbers[0],
        lastBlock: blockNumbers[blockNumbers.length - 1],
        blockCount: blockNumbers.length
    };
}

/**
 * Writes committed blocks into the `tron` tables, in order, in batches.
 *
 * A utility rather than a singleton service: `BlockchainService` constructs the
 * one instance it needs, with the ClickHouse service it was given, so a test can
 * build another against a fake.
 */
export class ChainDataWriter implements IChainDataSink {
    /** Blocks waiting for the next write, oldest first. */
    private readonly pending: IChainDataRows[] = [];

    /** Blocks taken by the write in flight. Counted against the limit with `pending`. */
    private inFlight = 0;

    /** The write loop while it is running, or null when there is nothing to write. */
    private running: Promise<void> | null = null;

    /** Whether every table is known to exist. */
    private schemaReady = false;

    /** When the last schema attempt failed, so the next one waits its turn; null when none has failed. */
    private schemaFailedAt: number | null = null;

    /**
     * The highest block this process has written completely, or null before the
     * first. Only the height and time are kept, so the writer does not hold a
     * whole block's rows in memory for the life of the process.
     */
    private highestWritten: { blockNumber: number; blockTimestamp: string } | null = null;

    /**
     * The highest block `_ingest_state` is known to hold for this writer, or
     * null when it holds none. Read back from ClickHouse before the first
     * progress write, so a new process never records a lower block than an
     * earlier process already did. Without it, a block refilled by the gap scan
     * soon after a restart would be the highest this process had seen and would
     * move the recorded progress backwards.
     */
    private recordedProgress: number | null = null;

    /** Whether {@link recordedProgress} has been read from ClickHouse yet. */
    private progressLoaded = false;

    /** Set once shutdown has begun, after which failed calls are not retried. */
    private shuttingDown = false;

    /**
     * Blocks lost while the gap table did not exist yet, oldest first. They are
     * written to `_ingest_gap` as soon as the schema is ready, so a ClickHouse
     * that was unreachable at boot still leaves a record of every block it
     * missed instead of a hole nobody can tell from a quiet block.
     */
    private readonly deferredGaps: IDeferredGap[] = [];

    /** Lost blocks that did not fit in {@link deferredGaps}, so were never recorded. */
    private droppedDeferredGaps = 0;

    /**
     * Blocks refused because the queue was full, oldest first, waiting to be
     * recorded as gaps. Only the block numbers are held, so this costs almost
     * no memory however long ClickHouse stays stalled.
     *
     * The write loop records them all in one insert after each batch, rather
     * than each refusal starting an insert of its own. Refusals arrive once per
     * block for as long as ClickHouse is stalled, and a separate retried insert
     * for each one would put several extra writes on a ClickHouse that is
     * already struggling, take pooled connections the traffic and account
     * history modules also need, and log one `fatal` line per block.
     */
    private readonly refusedGaps: number[] = [];

    private readonly retentionDays: number;
    private readonly maxQueued: number;
    private readonly maxBatch: number;
    private readonly schemaRetryMs: number;
    private readonly maxAttempts: number;
    private readonly retryDelayMs: number;
    private readonly now: () => Date;
    /** The injected wait, or undefined to let `retry()` use a real timer. */
    private readonly sleep: ((ms: number) => Promise<void>) | undefined;

    /**
     * Build a writer with every limit resolved once, so the write loop never
     * has to fall back to a default mid-batch. Nothing touches ClickHouse here;
     * the tables are created when the first block arrives.
     *
     * @param clickhouse - The ClickHouse service the tables are created and written through.
     * @param options - The provider name to stamp on rows, and the limits described on
     *                  {@link IChainDataWriterOptions}.
     */
    constructor(
        private readonly clickhouse: IClickHouseService,
        private readonly options: IChainDataWriterOptions
    ) {
        this.retentionDays = options.retentionDays ?? CHAIN_DATA_RETENTION_DAYS;
        this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
        // At least one, because a batch of zero never shrinks the queue and
        // the write loop would spin on microtasks alone, starving the process.
        this.maxBatch = Math.max(1, options.maxBatch ?? DEFAULT_MAX_BATCH);
        this.schemaRetryMs = options.schemaRetryMs ?? DEFAULT_SCHEMA_RETRY_MS;
        this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
        this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
        this.now = options.now ?? (() => new Date());
        this.sleep = options.sleep;
    }

    /**
     * Accept one committed block's rows and return immediately.
     *
     * A block arriving while the queue is full is refused and recorded as a gap
     * rather than queued, because an unbounded queue behind a stalled ClickHouse
     * would hold every block's rows in memory until the process ran out. The
     * gap is written by the write loop after its current batch, together with
     * any other block refused meanwhile; see {@link refusedGaps}.
     *
     * @param rows - The rows the block contributes to each table.
     */
    public submit(rows: IChainDataRows): void {
        if (this.pending.length + this.inFlight >= this.maxQueued) {
            this.refusedGaps.push(rows.blockNumber);
        } else {
            this.pending.push(rows);
        }
        this.ensurePumping();
    }

    /**
     * Start the write loop unless it is already running.
     *
     * Called for refused blocks too, not only queued ones. A full queue means
     * the loop is running in practice, but starting it here as well means a
     * refused block's gap is written even under a configuration where that is
     * not true, such as a batch size at least as large as the queue limit.
     *
     * The loop can finish its last check and a block can then be submitted
     * before `running` is cleared, because clearing it waits for a later
     * microtask. That submit sees a loop still marked as running and does not
     * start one, so the cleanup starts a new loop itself when anything is left
     * waiting. Without that, the block would sit unwritten until the next
     * submit, and at shutdown `drain()` would return with it still queued.
     */
    private ensurePumping(): void {
        if (this.running === null) {
            this.running = this.pump().finally(() => {
                this.running = null;
                if (this.pending.length > 0 || this.refusedGaps.length > 0) {
                    this.ensurePumping();
                }
            });
        }
    }

    /**
     * Wait until every submitted block has been written or recorded as a gap.
     *
     * Shutdown calls this through `BlockchainService.shutdown()`, so blocks
     * already committed to MongoDB reach ClickHouse, or `_ingest_gap`, before the
     * process exits. Tests call it to wait for the write loop.
     *
     * @param options - `shuttingDown` stops further retries, so a shutdown with a
     *                  timeout still ends with every block written or recorded
     *                  as a gap.
     * @returns Resolves once nothing is waiting or in flight, including the gaps
     *          for blocks the full queue refused, which the write loop records.
     */
    public async drain(options: IChainDataDrainOptions = {}): Promise<void> {
        if (options.shuttingDown) {
            this.stopRetrying();
        }
        while (this.running !== null) {
            await this.running;
        }
        // Gaps held in memory because the gap table never came to exist die
        // with the process. Nothing can write them now, so the operator is told
        // how many and which stretch, since `_ingest_gap` will not show them.
        const unrecorded = this.deferredGaps.length + this.droppedDeferredGaps;
        if (options.shuttingDown && unrecorded > 0) {
            logger.fatal(
                { count: unrecorded, ...describeBlocks(this.deferredGaps.map(gap => gap.blockNumber)) },
                'Shutting down with chain data gaps that were never recorded, because the gap table did not exist; they are missing from _ingest_gap'
            );
        }
    }

    /**
     * Stop retrying failed ClickHouse calls from now on, without waiting.
     *
     * Shutdown calls this before anything else, because the writer may already
     * be retrying an earlier batch while the committer finishes its last block,
     * and those retry delays would otherwise use up the shutdown timeout before
     * the blocks become gaps. A call that fails from here on is recorded as a
     * gap straight away.
     */
    public stopRetrying(): void {
        this.shuttingDown = true;
    }

    /**
     * Write batches until nothing is waiting, recording refused blocks as gaps
     * between them.
     *
     * One loop at a time is what keeps blocks in order: a later batch cannot
     * start until the one before it has finished. Running the refused-block
     * gap write inside the same loop is what keeps it to one ClickHouse insert
     * at a time, however many blocks were refused.
     */
    private async pump(): Promise<void> {
        while (this.pending.length > 0 || this.refusedGaps.length > 0) {
            if (this.pending.length > 0) {
                const batch = this.pending.splice(0, this.maxBatch);
                this.inFlight = batch.length;
                try {
                    await this.writeBatch(batch);
                } catch (error) {
                    // writeBatch is built not to throw. If a bug makes it throw
                    // anyway, the batch becomes gaps and the loop carries on,
                    // because a rejected loop would be an unhandled rejection and
                    // would leave `inFlight` counting blocks that are gone.
                    const message = error instanceof Error ? error.message : String(error);
                    logger.error({ error, ...describeBlocks(batch.map(rows => rows.blockNumber)) }, 'Chain data batch failed unexpectedly');
                    await this.recordGaps(batch.map(rows => rows.blockNumber), `unexpected writer error: ${message}`);
                } finally {
                    this.inFlight = 0;
                }
            }
            await this.flushRefusedGaps();
        }
    }

    /**
     * Record every block the full queue refused since the last flush, in one insert.
     *
     * Takes the whole list at once, so blocks refused while this insert runs
     * wait for the next pass of the loop rather than starting inserts of their
     * own. Never throws, because {@link recordGaps} does not.
     */
    private async flushRefusedGaps(): Promise<void> {
        const blockNumbers = this.refusedGaps.splice(0);
        if (blockNumbers.length > 0) {
            await this.recordGaps(blockNumbers, `writer queue full (${this.maxQueued} blocks waiting)`);
        }
    }

    /**
     * Run one ClickHouse call, retrying it through the shared `retry()` helper
     * until it succeeds or the attempts run out.
     *
     * Most ClickHouse failures are brief, so giving up on the first one would
     * turn a moment's outage into gaps. The waiting itself is the shared
     * helper's, so the writer backs off the same way every other retrying
     * caller does, with the base wait doubling and each wait jittered. This
     * method adds only what the writer needs on top: each failed attempt that
     * will be retried is logged as a warning, and when every attempt has failed
     * the failure is logged at `fatal` with the consequence the caller
     * describes, because data is now missing from ClickHouse, and returned
     * rather than thrown so the write loop can record gaps and carry on. After
     * shutdown begins, a failure is not retried, so the shutdown timeout is not
     * spent waiting between attempts.
     *
     * @param consequence - What it means when this call fails every attempt,
     *                      written into the fatal log line for an operator.
     * @param context - Fields that identify the call in the log, such as the
     *                  table and the blocks involved.
     * @param call - The ClickHouse call to make. Called once per attempt.
     * @returns Whether some attempt succeeded, with the last error when none did.
     */
    private async withRetry(
        consequence: string,
        context: Record<string, unknown>,
        call: () => Promise<void>
    ): Promise<IWriteOutcome> {
        let outcome: IWriteOutcome;
        let attempts = 1;
        try {
            await retry(call, {
                retries: this.maxAttempts - 1,
                delayMs: this.retryDelayMs,
                factor: 2,
                // Every ClickHouse failure is worth another try, except once
                // shutdown has begun and the time is needed to record gaps.
                shouldRetry: () => !this.shuttingDown,
                sleep: this.sleep,
                onRetry: (attempt, error, delayMs) => {
                    attempts = attempt + 1;
                    logger.warn(
                        { error, attempt, maxAttempts: this.maxAttempts, delayMs, ...context },
                        'ClickHouse chain data call failed; retrying'
                    );
                }
            });
            outcome = { succeeded: true };
        } catch (error) {
            logger.fatal(
                { error, attempts, ...context },
                `ClickHouse chain data call failed on every attempt: ${consequence}`
            );
            outcome = { succeeded: false, error };
        }
        return outcome;
    }

    /**
     * Write one batch of blocks, or record why they could not be written.
     *
     * Every table is written together, each insert carrying that table's rows
     * from every block in the batch. Each insert is synchronous (see
     * {@link INSERT_OPTIONS}), so a failure throws here and becomes a gap
     * rather than disappearing into the asynchronous-insert log. Each table's insert is
     * retried on its own, so one table failing does not repeat the tables that
     * already succeeded. `_ingest_state` is updated only after every table
     * succeeded, so it never claims a block that is incomplete. A failed batch
     * records a gap for each of its blocks, since nothing says which of them the
     * failing insert would have held.
     *
     * @param batch - The blocks to write, in order.
     */
    private async writeBatch(batch: IChainDataRows[]): Promise<void> {
        const ready = await this.ensureSchema();
        if (!ready) {
            await this.recordGaps(batch.map(rows => rows.blockNumber), 'chain data tables did not exist yet');
        } else {
            const unbuilt = batch.filter(rows => rows.failure !== undefined);
            for (const rows of unbuilt) {
                await this.recordGaps([rows.blockNumber], `rows could not be built: ${rows.failure}`);
            }

            const built = batch.filter(rows => rows.failure === undefined);
            if (built.length > 0) {
                const stamp = this.bookkeeping();
                const blockNumbers = built.map(rows => rows.blockNumber);
                // Every table is attempted, retries included, before the batch
                // is judged, so one failing table does not leave the others
                // unwritten. The inserts run one after another rather than all
                // at once: a batch can touch sixteen tables, more than the
                // shared client's ten pooled connections, and sending them
                // together would make every other ClickHouse caller queue
                // behind this one batch. withRetry never rejects.
                const outcomes: IWriteOutcome[] = [];
                for (const [table, tableRows] of Object.entries(this.mergeTables(built))) {
                    // Stamped once per table rather than once per attempt, so a
                    // retry resends the same rows without copying them again.
                    const stampedRows = tableRows.map(row => ({ ...row, ...stamp }));
                    outcomes.push(await this.withRetry(
                        'these blocks are recorded as gaps',
                        { table: `${CHAIN_DATA_DATABASE}.${table}`, ...describeBlocks(blockNumbers) },
                        () => this.clickhouse.insert(`${CHAIN_DATA_DATABASE}.${table}`, stampedRows, INSERT_OPTIONS)
                    ));
                }
                const failed = outcomes.find(outcome => !outcome.succeeded);

                if (failed) {
                    const message = failed.error instanceof Error ? failed.error.message : String(failed.error);
                    await this.recordGaps(blockNumbers, message);
                } else {
                    await this.recordProgress(built, stamp);
                }
            }
        }
    }

    /**
     * Record in `_ingest_state` the highest block written so far.
     *
     * Kept apart from the data inserts so a failure here cannot record gaps for
     * blocks whose rows were all committed. The progress row is written only
     * when this process has written a block higher than the one `_ingest_state`
     * already holds, including a value an earlier process left there. That keeps
     * the recorded progress from moving backwards when the gap scan refills an
     * older block, whether before or after a restart. Until the stored value can
     * be read, no progress row is written at all, because writing blind is
     * exactly what could move it backwards.
     *
     * @param built - The blocks just written, in commit order.
     * @param stamp - The bookkeeping columns stamped on this write's rows.
     */
    private async recordProgress(
        built: IChainDataRows[],
        stamp: { _provider: string; _ingested_at: string }
    ): Promise<void> {
        for (const rows of built) {
            if (this.highestWritten === null || rows.blockNumber > this.highestWritten.blockNumber) {
                this.highestWritten = { blockNumber: rows.blockNumber, blockTimestamp: rows.blockTimestamp };
            }
        }
        const highest = this.highestWritten as { blockNumber: number; blockTimestamp: string };
        const loaded = await this.loadRecordedProgress();
        const advanced = this.recordedProgress === null || highest.blockNumber > this.recordedProgress;

        if (loaded && advanced) {
            const outcome = await this.withRetry(
                'the recorded progress is behind what was written; the next batch tries again',
                { table: `${CHAIN_DATA_DATABASE}._ingest_state`, blockNumber: highest.blockNumber },
                () => this.clickhouse.insert(`${CHAIN_DATA_DATABASE}._ingest_state`, [{
                    writer: WRITER_NAME,
                    block_number: highest.blockNumber,
                    block_timestamp: highest.blockTimestamp,
                    ...stamp
                }], INSERT_OPTIONS)
            );
            if (outcome.succeeded) {
                this.recordedProgress = highest.blockNumber;
            }
        }
    }

    /**
     * Read the highest block `_ingest_state` holds for this writer, once per process.
     *
     * Takes the maximum over every stored row rather than the newest one. Rows
     * written before this guard existed may have moved progress backwards, and
     * the maximum is the true high point regardless of which row ClickHouse's
     * merge kept. When the read fails every attempt it is tried again on the
     * next batch, and until then no progress is written.
     *
     * @returns True once the stored value is known, so the caller may compare against it.
     */
    private async loadRecordedProgress(): Promise<boolean> {
        if (!this.progressLoaded) {
            const outcome = await this.withRetry(
                'progress is not recorded until the stored value can be read; the next batch tries again',
                { table: `${CHAIN_DATA_DATABASE}._ingest_state`, writer: WRITER_NAME },
                async () => {
                    const rows = await this.clickhouse.query<{ block_number: string | number }>(
                        `SELECT max(block_number) AS block_number FROM ${CHAIN_DATA_DATABASE}._ingest_state WHERE writer = {writer:String}`,
                        { writer: WRITER_NAME }
                    );
                    const stored = Number(rows[0]?.block_number ?? 0);
                    this.recordedProgress = Number.isFinite(stored) && stored > 0 ? stored : null;
                }
            );
            this.progressLoaded = outcome.succeeded;
        }
        return this.progressLoaded;
    }

    /**
     * Combine several blocks' rows into one list per table, leaving out empty tables.
     *
     * @param batch - The blocks whose rows to combine, in order.
     * @returns Rows per table, in block order within each table.
     */
    private mergeTables(batch: IChainDataRows[]): Record<string, ChainDataRow[]> {
        const merged: Record<string, ChainDataRow[]> = {};
        for (const rows of batch) {
            for (const [table, tableRows] of Object.entries(rows.tables)) {
                if (tableRows.length > 0) {
                    (merged[table] ??= []).push(...tableRows);
                }
            }
        }
        return merged;
    }

    /**
     * Make sure the `tron` database and every table exist.
     *
     * Runs the schema's statements the first time a block arrives, retrying
     * them like any other call, and again after a failure once the schema retry
     * delay has passed, so a ClickHouse that was unreachable at boot is picked
     * up without a restart. Blocks lost while the schema was missing are held
     * in memory, because the gap table is part of what is missing, and written
     * to it here once it exists.
     *
     * @returns True once every table is known to exist.
     */
    private async ensureSchema(): Promise<boolean> {
        const nowMs = this.now().getTime();
        const waiting = this.schemaFailedAt !== null && nowMs - this.schemaFailedAt < this.schemaRetryMs;
        if (!this.schemaReady && !waiting) {
            const outcome = await this.withRetry(
                `the chain data tables could not be created; blocks are held as gaps and the tables are tried again in ${this.schemaRetryMs} ms`,
                { database: CHAIN_DATA_DATABASE },
                async () => {
                    for (const statement of buildChainDataSchema(this.retentionDays)) {
                        await this.clickhouse.exec(statement);
                    }
                }
            );
            if (outcome.succeeded) {
                this.schemaReady = true;
                this.schemaFailedAt = null;
                logger.info({ database: CHAIN_DATA_DATABASE }, 'ClickHouse chain data tables are ready');
                await this.flushDeferredGaps();
            } else {
                this.schemaFailedAt = nowMs;
            }
        }
        return this.schemaReady;
    }

    /**
     * Record blocks the writer could not write.
     *
     * Never throws: a failure here is retried, then logged at `fatal` and
     * dropped, because nothing further can be done about a block whose gap
     * cannot be recorded, and throwing would stop the write loop behind it.
     *
     * @param blockNumbers - The blocks missing from the tables.
     * @param reason - Why, in words an operator can act on.
     */
    private async recordGaps(blockNumbers: number[], reason: string): Promise<void> {
        if (!this.schemaReady) {
            logger.warn({ ...describeBlocks(blockNumbers), reason }, 'Chain data blocks lost before the gap table existed; recording them once it does');
            for (const blockNumber of blockNumbers) {
                if (this.deferredGaps.length < MAX_DEFERRED_GAPS) {
                    this.deferredGaps.push({ blockNumber, reason });
                } else {
                    this.droppedDeferredGaps += 1;
                }
            }
        } else {
            const recordedAt = formatClickHouseDateTime64Utc(this.now());
            await this.withRetry(
                'these blocks are missing from ClickHouse and from _ingest_gap, so nothing records that they are missing',
                // Summarized rather than listed: a flush of gaps held while the
                // tables were missing can name tens of thousands of blocks, and
                // this context is repeated on every retry warning and the fatal.
                { table: `${CHAIN_DATA_DATABASE}._ingest_gap`, ...describeBlocks(blockNumbers), reason },
                () => this.clickhouse.insert(`${CHAIN_DATA_DATABASE}._ingest_gap`, blockNumbers.map(blockNumber => ({
                    block_number: blockNumber,
                    reason: reason.slice(0, MAX_GAP_REASON_LENGTH),
                    recorded_at: recordedAt,
                    _provider: this.options.provider
                })), INSERT_OPTIONS)
            );
        }
    }

    /**
     * Write every gap held while the gap table did not exist.
     *
     * Called once the schema is ready. Gaps are grouped by reason so each reason
     * costs one insert. Lost blocks that overflowed the in-memory bound cannot be
     * named any more, so their count is logged at `fatal` for an operator to act
     * on, since the gap table will not show them.
     */
    private async flushDeferredGaps(): Promise<void> {
        const deferred = this.deferredGaps.splice(0);
        const byReason = new Map<string, number[]>();
        for (const gap of deferred) {
            const blockNumbers = byReason.get(gap.reason) ?? [];
            blockNumbers.push(gap.blockNumber);
            byReason.set(gap.reason, blockNumbers);
        }
        for (const [reason, blockNumbers] of byReason) {
            await this.recordGaps(blockNumbers, reason);
        }
        if (this.droppedDeferredGaps > 0) {
            logger.fatal(
                { count: this.droppedDeferredGaps },
                'Chain data blocks were lost before the gap table existed and could not all be remembered; they are missing from _ingest_gap'
            );
            this.droppedDeferredGaps = 0;
        }
    }

    /**
     * The columns the ingest adds to every row.
     *
     * @returns `_provider` and `_ingested_at` for the current write.
     */
    private bookkeeping(): { _provider: string; _ingested_at: string } {
        return {
            _provider: this.options.provider,
            _ingested_at: formatClickHouseDateTime64Utc(this.now())
        };
    }
}
