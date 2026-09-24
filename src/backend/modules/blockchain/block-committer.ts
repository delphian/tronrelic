/**
 * @fileoverview Writing a prepared block and telling everything about it.
 *
 * The pipeline is split so that fetching runs flat out and everything else runs
 * on the chain's own three-second clock. `BlockchainService` fetches a block,
 * parses it, and hands the result to `BlockEmitter` without writing anything.
 * The emitter holds a lead of prepared blocks and releases one per slot, and a
 * release lands here: the block is written to MongoDB, the sync cursor advances,
 * observers are notified, alerts are ingested, and `block:new` is broadcast.
 *
 * Putting persistence behind the buffer is the whole point of the arrangement.
 * When only the broadcast was paced, the REST endpoints read a height the live
 * feed had not reached, and observer-derived data was written at a third height
 * again. Now nothing is in the database until its slot arrives, so every read
 * surface — the API, a server-rendered page, a plugin's own collections, the
 * feed — reports the same height by construction rather than by discipline at
 * each read site. The cost is that the whole deployment sits about a buffer's
 * depth behind the chain head, which is the trade this design accepts.
 *
 * Two properties are easy to break in a later change. Commits are **serialized**
 * through one promise chain, because they advance a shared cursor and drive a
 * batch accumulator that is shared across blocks; two commits in flight at once
 * would interleave both. And every step swallows its own errors, because a
 * commit is started from the emitter's timer callback, where an escaping error
 * would kill the release clock and freeze the pipeline with no obvious cause.
 *
 * @module backend/modules/blockchain/block-committer
 */

import type { IBlockData, IBlockchainObserverService, ITransactionPersistencePayload } from '@/types';
import type { IBlockCommitSink, IBlockNewPayload, IPreparedBlock } from './block-emitter.js';
import type { PipelineTelemetry } from './pipeline-telemetry.js';
import type { IChainDataSink } from './chain-data/ChainDataWriter.js';
import { logger } from './logger.js';

/**
 * The one thing the committer needs from the alert system.
 *
 * Narrowed to a single method rather than taking `AlertService` itself so a test
 * can pass a spy without constructing a service that reaches for MongoDB and the
 * TronGrid client.
 */
export interface IAlertIngestor {
    /**
     * Match one block's transactions against the configured alert rules.
     *
     * @param transactions - The persistence payloads for a single block, which
     *                       is the shape the alert rules are written against.
     * @returns Resolves when ingestion finishes. The committer never waits on
     *          it and uses the promise only to attach an error handler, so a
     *          slow rule set cannot delay the next slot.
     */
    ingestTransactions(transactions: ITransactionPersistencePayload[]): Promise<unknown>;
}

/** The collaborators a released block is written to and fanned out to. */
export interface IBlockCommitterDependencies {
    /**
     * Writes the block: its transactions, the block document, the sync cursor,
     * and the timing breakdown.
     *
     * Supplied as a callback rather than moving the write code here, because
     * those writes belong to `BlockchainService` along with its models and
     * collection names. Keeping them there means this class owns the *ordering*
     * of a commit without also owning its storage layout.
     *
     * @param prepared - The block to write.
     * @returns True when this is the first commit of the block to finish every
     *          durable write, false when an earlier commit already did. The
     *          committer announces a block only when this is true, so a block
     *          fetched twice reaches observers once, and a block whose earlier
     *          commit stopped partway reaches them when it is fetched again.
     */
    persist: (prepared: IPreparedBlock) => Promise<boolean>;
    /** Registry that knows which observers subscribed to which contract types. */
    observers: IBlockchainObserverService;
    /** Alert rule matching, called once per block with that block's payloads. */
    alerts: IAlertIngestor;
    /**
     * Sends the `block:new` event to connected clients. Injected as a plain
     * function so this class never imports the WebSocket service, which lets a
     * test assert on exactly what was broadcast without a running server.
     */
    broadcast: (payload: IBlockNewPayload) => void;
    /**
     * Where the committer reports each write and each failure for the
     * `/system` Pipeline tab. Narrowed to the two methods it calls so a test
     * can pass a spy instead of the shared recorder.
     */
    telemetry: Pick<PipelineTelemetry, 'recordCommitted' | 'recordError'>;
    /**
     * Where each committed block's rows for the ClickHouse `tron` tables go.
     * Optional because ClickHouse is: a deployment without it has no sink, and
     * commits behave exactly as they did before chain data existed.
     */
    chainData?: IChainDataSink;
}

/** What the committer reports to `/system` about its own health. */
export interface IBlockCommitMetrics {
    /**
     * Blocks handed over and not yet written. Anything above zero for more than
     * a moment means committing is slower than the release clock, which is the
     * one failure this arrangement can produce that the emitter's own metrics
     * cannot show.
     */
    queued: number;
    /** Height of the last block successfully written, or null before the first. */
    lastCommittedBlockNumber: number | null;
    /** Commits that threw. A rising count means blocks are reaching no surface at all. */
    failures: number;
}

/**
 * Writes released blocks and announces them, one at a time in order.
 *
 * Built as a class taking its collaborators through the constructor rather than
 * reaching for singletons itself, because the alert service is created per
 * `BlockchainService` instance and because a test needs to drive a commit with
 * spies instead of a live database and WebSocket server.
 */
export class BlockCommitter implements IBlockCommitSink {
    /**
     * The tail of the commit chain. Each submission appends to it, which is what
     * guarantees one commit at a time without a lock or a worker: the chain
     * cannot run its next link until the previous one settles.
     */
    private tail: Promise<void> = Promise.resolve();

    private queued = 0;
    private lastCommittedBlockNumber: number | null = null;
    private failures = 0;

    /**
     * @param deps - The persist callback, observer registry, alert ingestor, and
     *               broadcast function to commit each released block through.
     *               Passed in so the committer stays free of module-level
     *               singletons and can be constructed against test doubles.
     */
    constructor(private readonly deps: IBlockCommitterDependencies) {}

    /**
     * Accept a released block for commit and return immediately.
     *
     * Returning without waiting is what keeps the emitter's cadence honest: the
     * release clock measures slots, not how long a write takes, so a slow commit
     * shows up as a rising {@link IBlockCommitMetrics.queued} rather than as a
     * feed that drifts. Ordering is still guaranteed, because every submission
     * appends to one promise chain.
     *
     * @param prepared - The block whose slot has arrived.
     */
    public submit(prepared: IPreparedBlock): void {
        this.queued += 1;
        this.tail = this.tail.then(() => this.commit(prepared));
    }

    /**
     * Wait until every block already submitted has finished committing.
     *
     * Shutdown needs this before it waits on the chain data writer. A block
     * whose MongoDB write is still in flight hands its chain data rows over
     * only when that write finishes, so draining the writer first would find
     * it idle and let the process exit before the rows ever arrived.
     *
     * @returns Resolves once the commit chain has settled. Never rejects,
     *          because each commit catches its own failure.
     */
    public async drain(): Promise<void> {
        let observed: Promise<void> | null = null;
        while (observed !== this.tail) {
            observed = this.tail;
            await observed;
        }
    }

    /**
     * Report the commit backlog for the `/system` blockchain console.
     *
     * @returns A snapshot an operator can read to tell a healthy pipeline from
     *          one where writing has fallen behind the release clock.
     */
    public getMetrics(): IBlockCommitMetrics {
        const metrics: IBlockCommitMetrics = {
            queued: this.queued,
            lastCommittedBlockNumber: this.lastCommittedBlockNumber,
            failures: this.failures
        };

        return metrics;
    }

    /**
     * Write one block and tell everything about it.
     *
     * Persistence comes first and is the only awaited step, because it is what
     * makes the block real: a consumer that hears about a block and then queries
     * for it must find it. Everything after is fire-and-forget, so a slow
     * observer or a failing alert rule cannot hold up the next block in the
     * chain.
     *
     * A failed write is logged and the block is dropped rather than retried
     * here, because retrying inside the commit chain would stall every block
     * behind it for a fault the normal path already repairs.
     *
     * Recovery is worth stating precisely, because the obvious answer is wrong.
     * The next tick's forward walk does **not** pick the block up: that walk
     * resumes from `meta.lastFetchedBlock`, which advanced when the block was
     * buffered, not from the cursor. What actually finds it is
     * `identifyMissingBlocks`, once a later block advances the cursor past the
     * hole and the gap scan sees no block document at that height, or
     * `resetFetchHeightToCursor()` at the next startup. Both depend on the
     * block genuinely not having been written, which is why the telemetry write
     * at the end of `persistPreparedBlock` is wrapped there rather than allowed
     * to reject — a durable block with a failed commit would be invisible to
     * both.
     *
     * A block whose earlier commit already finished is written again, so the
     * cursor and the backfill queue catch up, but it is not announced a second
     * time to the observers, the alert rules, or connected clients, because
     * doing that twice would show up as duplicate alerts and duplicate plugin
     * records. `persist` decides this from a stamp its last durable write
     * sets, not from whether the block document already existed, so a block
     * whose earlier commit stopped before that write is announced when it is
     * fetched again.
     *
     * Its chain data is still handed to ClickHouse, and its commit is still
     * recorded in telemetry. A finished MongoDB commit does not prove the
     * hand-off happened: a process that stopped between the two (a crash, or
     * a shutdown whose drain timed out) leaves the block committed in MongoDB
     * but missing from ClickHouse, and the refetch is the only chance to write
     * it there. Writing it twice is harmless, because every chain data table
     * is a `ReplacingMergeTree` keyed on the row's identity.
     *
     * @param prepared - The block to write and announce.
     */
    private async commit(prepared: IPreparedBlock): Promise<void> {
        try {
            const isFirstCommit = await this.deps.persist(prepared);
            this.lastCommittedBlockNumber = prepared.blockNumber;

            // Handed over straight after the write, before anything else can
            // throw, and for a repeat as well as a new block. A later step
            // failing here would otherwise leave the block missing from
            // ClickHouse with no gap recorded.
            this.recordChainData(prepared);
            this.deps.telemetry.recordCommitted(prepared.blockNumber, prepared.timings);

            if (isFirstCommit) {
                this.dispatchToObservers(prepared.blockData);
                this.broadcast(prepared);
                this.ingestAlerts(prepared.blockData);
            } else {
                logger.info(
                    { blockNumber: prepared.blockNumber },
                    'Block was already committed; wrote it again without announcing it a second time'
                );
            }
        } catch (error) {
            this.failures += 1;
            this.deps.telemetry.recordError({
                blockNumber: prepared.blockNumber,
                stage: 'commit',
                errorClass: 'commit',
                message: error instanceof Error ? error.message : String(error)
            });
            logger.error(
                { error, blockNumber: prepared.blockNumber },
                'Failed to commit a released block; nothing durable was written, so the gap scan or the next startup will pick it up'
            );
        } finally {
            this.queued -= 1;
        }
    }

    /**
     * Hand a block's transactions to the per-transaction, batch, and block
     * observers, and its contract events to the event observers.
     *
     * Deliberately written without a single `await`. The observer service keeps
     * one batch accumulator that is cleared at the start of a block and flushed
     * at the end, and that accumulator is shared across every block. Awaiting
     * anywhere between the clear and the flush would yield to the event loop and
     * let another commit clear or add to the accumulator midway, so batch
     * observers would receive one block's transactions mixed with another's.
     * Every call made here is either synchronous or fire-and-forget by contract,
     * so waiting would buy nothing anyway.
     *
     * @param blockData - The assembled block, whose `transactions` array is the
     *                    same one that was just written to MongoDB.
     */
    private dispatchToObservers(blockData: IBlockData): void {
        try {
            this.deps.observers.clearBatchAccumulator();

            for (const transaction of blockData.transactions) {
                void this.deps.observers.notifyTransaction(transaction).catch(error => {
                    logger.error(
                        { error, blockNumber: blockData.blockNumber, txId: transaction.payload.txId },
                        'Failed to notify transaction observers for a committed block'
                    );
                });

                this.deps.observers.accumulateForBatch(transaction);
            }

            void this.deps.observers.flushBatches().catch(error => {
                logger.error(
                    { error, blockNumber: blockData.blockNumber },
                    'Failed to flush batch observers for a committed block'
                );
            });

            void this.deps.observers.notifyBlock(blockData).catch(error => {
                logger.error(
                    { error, blockNumber: blockData.blockNumber },
                    'Failed to notify block observers for a committed block'
                );
            });

            void this.deps.observers.notifyBlockEvents(blockData).catch(error => {
                logger.error(
                    { error, blockNumber: blockData.blockNumber },
                    'Failed to notify event observers for a committed block'
                );
            });
        } catch (error) {
            logger.error(
                { error, blockNumber: blockData.blockNumber },
                'Observer dispatch failed for a committed block'
            );
        }
    }

    /**
     * Send the `block:new` event to connected clients.
     *
     * Wrapped separately from the write because the two fail for unrelated
     * reasons, and a socket server that has gone away must not make a block that
     * was written successfully look like a failed commit.
     *
     * @param prepared - The committed block, read only for its wire payload.
     */
    private broadcast(prepared: IPreparedBlock): void {
        try {
            this.deps.broadcast(prepared.payload);
        } catch (error) {
            logger.error({ error, blockNumber: prepared.blockNumber }, 'Failed to broadcast a committed block');
        }
    }

    /**
     * Match the block's transactions against the alert rules.
     *
     * Runs after the write so an alert cannot name a block a reader could not
     * yet find, which was possible when ingestion and announcement ran at
     * different heights.
     *
     * @param blockData - The assembled block, whose transactions supply the
     *                    persistence payloads the rules are written against.
     */
    private ingestAlerts(blockData: IBlockData): void {
        const payloads = blockData.transactions.map(transaction => transaction.payload);

        void this.deps.alerts.ingestTransactions(payloads).catch(error => {
            logger.error(
                { error, blockNumber: blockData.blockNumber },
                'Failed to ingest alerts for a committed block'
            );
        });
    }

    /**
     * Hand the block's chain data rows to the ClickHouse writer.
     *
     * Runs after the MongoDB write for the same reason the announcements do: the
     * chain data must describe blocks that were actually committed, so its height
     * matches every other surface. The sink returns at once and does its own
     * writing, so ClickHouse being slow or down cannot hold up the next block.
     *
     * @param prepared - The committed block, read only for its chain data rows.
     */
    private recordChainData(prepared: IPreparedBlock): void {
        if (this.deps.chainData && prepared.chainData) {
            try {
                this.deps.chainData.submit(prepared.chainData);
            } catch (error) {
                logger.error({ error, blockNumber: prepared.blockNumber }, 'Failed to hand a committed block to the chain data writer');
            }
        }
    }
}
