/**
 * Unit tests for writing a released block and telling everything about it.
 *
 * Five properties matter here, and each fails silently in production if it
 * regresses. The write must happen before anything is told about the block, or a
 * client that hears about a height and queries for it finds nothing. Commits
 * must be serialized, because they advance a shared cursor and drive a batch
 * accumulator shared across blocks. A failed write must not announce the block,
 * since the cursor did not advance and the next tick will fetch it again. A
 * block whose earlier commit already finished must not be announced twice. And nothing may
 * throw, because a commit starts inside the emitter's timer callback where an
 * escaping error kills the release clock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IBlockData, IBlockchainObserverService, ITransaction } from '@/types';
import { BlockCommitter, type IBlockCommitterDependencies } from '../block-committer.js';
import type { IBlockNewPayload, IPreparedBlock } from '../block-emitter.js';

/**
 * Build a transaction carrying only the fields the committer and the observer
 * service read, which is the contract type and the id used in log context.
 *
 * @param txId - Identifier making the transaction distinguishable in assertions.
 * @returns An object usable wherever the commit expects a transaction.
 */
function buildTransaction(txId: string): ITransaction {
    return { payload: { txId, type: 'TransferContract' } } as unknown as ITransaction;
}

/**
 * Build the prepared block a release hands to the committer.
 *
 * @param blockNumber - Height being committed.
 * @param transactions - Transactions the block carries, so a test can assert on
 *                       per-transaction dispatch and on the alert payloads.
 * @returns A prepared block in the shape the emitter releases.
 */
function buildPrepared(blockNumber: number, transactions: ITransaction[]): IPreparedBlock {
    const blockData: IBlockData = {
        blockNumber,
        blockId: `block-${blockNumber}`,
        parentHash: `parent-${blockNumber}`,
        witnessAddress: 'unknown',
        timestamp: new Date(blockNumber * 3_000),
        transactionCount: transactions.length,
        receiptsFetched: false,
        transactions
    };

    return {
        blockNumber,
        payload: { blockNumber, timestamp: blockData.timestamp.toISOString(), receiptsFetched: false, stats: { transactions: transactions.length } } as IBlockNewPayload,
        blockData,
        stats: {} as IPreparedBlock['stats'],
        rawTransactionCount: transactions.length,
        timings: {}
    };
}

/**
 * Assemble a committer wired to spies, plus a log of the order calls arrived in.
 *
 * The order log is the only way to assert both the write-before-announce rule
 * and the accumulator discipline, because each is a relationship between
 * separate calls rather than a property of any one call's arguments.
 *
 * @param overrides - Dependencies to replace, used by the failure tests to make
 *                    one collaborator throw.
 * @returns The committer, its spies, and the ordered call log.
 */
function createCommitter(overrides: Partial<IBlockCommitterDependencies> = {}) {
    const calls: string[] = [];

    const observers = {
        clearBatchAccumulator: vi.fn(() => { calls.push('clear'); }),
        accumulateForBatch: vi.fn((transaction: ITransaction) => { calls.push(`accumulate:${transaction.payload.txId}`); }),
        notifyTransaction: vi.fn(async (transaction: ITransaction) => { calls.push(`notify:${transaction.payload.txId}`); }),
        flushBatches: vi.fn(async () => { calls.push('flush'); }),
        notifyBlock: vi.fn(async () => { calls.push('notifyBlock'); }),
        notifyBlockEvents: vi.fn(async () => { calls.push('notifyBlockEvents'); })
    } as unknown as IBlockchainObserverService;

    const persist = vi.fn(async (prepared: IPreparedBlock) => {
        calls.push(`persist:${prepared.blockNumber}`);
        return true;
    });
    const alerts = { ingestTransactions: vi.fn(async () => { calls.push('alerts'); }) };
    const broadcast = vi.fn(() => { calls.push('broadcast'); });
    const telemetry = { recordCommitted: vi.fn(), recordError: vi.fn() };

    const deps: IBlockCommitterDependencies = { persist, observers, alerts, broadcast, telemetry, ...overrides };

    return { committer: new BlockCommitter(deps), persist, observers, alerts, broadcast, telemetry, calls };
}

/**
 * Let the committer's promise chain settle.
 *
 * `submit` returns immediately by design, so every assertion about what a commit
 * did has to wait for the chain rather than for the call.
 *
 * @returns A promise resolving once pending microtasks have run.
 */
async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('BlockCommitter', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('writes the block before telling anything about it', async () => {
        // A client that receives block:new and immediately queries for that
        // height must find it. Announcing first reintroduces exactly the split
        // this pipeline was rearranged to remove.
        const { committer, calls } = createCommitter();

        committer.submit(buildPrepared(100, [buildTransaction('tx-1')]));
        await settle();

        expect(calls[0]).toBe('persist:100');
        expect(calls.indexOf('persist:100')).toBeLessThan(calls.indexOf('broadcast'));
        expect(calls.indexOf('persist:100')).toBeLessThan(calls.indexOf('notifyBlock'));
    });

    it('drives observers, the broadcast, and alerts from one commit', async () => {
        const { committer, observers, alerts, broadcast } = createCommitter();
        const transactions = [buildTransaction('tx-1'), buildTransaction('tx-2')];

        committer.submit(buildPrepared(100, transactions));
        await settle();

        expect(observers.notifyTransaction).toHaveBeenCalledTimes(2);
        expect(observers.notifyBlock).toHaveBeenCalledTimes(1);
        expect(observers.notifyBlockEvents).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(alerts.ingestTransactions).toHaveBeenCalledWith([transactions[0].payload, transactions[1].payload]);
    });

    it('reports each write and each failed commit to the pipeline telemetry', async () => {
        // The /system Pipeline tab reads commit history from telemetry, so a
        // commit that is not reported there is invisible to an operator.
        const { committer, telemetry } = createCommitter();
        committer.submit(buildPrepared(100, []));
        await settle();
        expect(telemetry.recordCommitted).toHaveBeenCalledWith(100, expect.any(Object));

        const failing = createCommitter({ persist: vi.fn(async () => { throw new Error('write failed'); }) });
        failing.committer.submit(buildPrepared(101, []));
        await settle();
        expect(failing.telemetry.recordError).toHaveBeenCalledWith(
            expect.objectContaining({ blockNumber: 101, stage: 'commit', message: 'write failed' })
        );
    });

    it('delivers contract events after the write, alongside the other observers', async () => {
        // Event observers read the same committed block as every other
        // observer, so they must not hear about it before it exists.
        const { committer, calls } = createCommitter();

        committer.submit(buildPrepared(100, [buildTransaction('tx-1')]));
        await settle();

        expect(calls.indexOf('persist:100')).toBeLessThan(calls.indexOf('notifyBlockEvents'));
        expect(calls.indexOf('notifyBlockEvents')).toBeLessThan(calls.indexOf('broadcast'));
    });

    it('commits one block at a time even when several are released together', async () => {
        // A catch-up run flushes the whole buffer in one go. Overlapping commits
        // would race the sync cursor and interleave the shared batch accumulator.
        const { committer, calls } = createCommitter();

        committer.submit(buildPrepared(100, []));
        committer.submit(buildPrepared(101, []));
        committer.submit(buildPrepared(102, []));
        await settle();

        const persists = calls.filter(call => call.startsWith('persist:'));
        expect(persists).toEqual(['persist:100', 'persist:101', 'persist:102']);
        expect(calls.indexOf('persist:101')).toBeGreaterThan(calls.indexOf('broadcast'));
    });

    it('clears, fills, and flushes the batch accumulator without yielding', async () => {
        // The accumulator is shared across blocks, so an await between clearing
        // and flushing would let another commit mix two blocks into one batch.
        const { committer, calls } = createCommitter();

        committer.submit(buildPrepared(100, [buildTransaction('tx-1'), buildTransaction('tx-2')]));
        await settle();

        expect(calls.slice(1, 7)).toEqual([
            'clear',
            'notify:tx-1',
            'accumulate:tx-1',
            'notify:tx-2',
            'accumulate:tx-2',
            'flush'
        ]);
    });

    it('announces nothing when the write fails', async () => {
        // The cursor did not advance, so the next tick fetches this block again.
        // Announcing it would name a height no reader can find.
        const persist = vi.fn(async () => { throw new Error('mongo gone'); });
        const { committer, observers, broadcast, alerts } = createCommitter({ persist });

        committer.submit(buildPrepared(100, [buildTransaction('tx-1')]));
        await settle();

        expect(broadcast).not.toHaveBeenCalled();
        expect(observers.notifyBlock).not.toHaveBeenCalled();
        expect(alerts.ingestTransactions).not.toHaveBeenCalled();
        expect(committer.getMetrics().failures).toBe(1);
    });

    it('writes a block whose earlier commit finished but does not announce it again', async () => {
        // The same block can be fetched twice when a tick enqueues it after its
        // first job finished but before its commit. The write still runs so the
        // cursor and backfill queue catch up, but a second announcement would
        // fire duplicate alerts and duplicate plugin records. The chain data is
        // still handed over, because a finished MongoDB commit does not prove
        // the block reached ClickHouse (the process may have stopped between
        // the two), and a repeated row collapses in ClickHouse.
        const persist = vi.fn(async () => false);
        const submit = vi.fn();
        const { committer, observers, broadcast, alerts, telemetry } = createCommitter({
            persist,
            chainData: { submit }
        });
        const prepared = buildPrepared(100, [buildTransaction('tx-1')]);
        prepared.chainData = { blockNumber: 100, blockTimestamp: '', tables: {} };

        committer.submit(prepared);
        await settle();

        expect(persist).toHaveBeenCalledTimes(1);
        expect(observers.notifyTransaction).not.toHaveBeenCalled();
        expect(observers.notifyBlock).not.toHaveBeenCalled();
        expect(broadcast).not.toHaveBeenCalled();
        expect(alerts.ingestTransactions).not.toHaveBeenCalled();
        expect(submit).toHaveBeenCalledTimes(1);
        expect(telemetry.recordCommitted).toHaveBeenCalledWith(100, prepared.timings);
        expect(committer.getMetrics().lastCommittedBlockNumber).toBe(100);
        expect(committer.getMetrics().failures).toBe(0);
    });

    it('keeps committing later blocks after one fails', async () => {
        // A single bad block must not wedge the chain behind it, or one failure
        // stops the pipeline permanently.
        let attempt = 0;
        const persist = vi.fn(async (prepared: IPreparedBlock) => {
            attempt += 1;
            if (attempt === 1) {
                throw new Error('transient');
            }
            return true;
        });
        const { committer } = createCommitter({ persist });

        committer.submit(buildPrepared(100, []));
        committer.submit(buildPrepared(101, []));
        await settle();

        expect(persist).toHaveBeenCalledTimes(2);
        expect(committer.getMetrics().lastCommittedBlockNumber).toBe(101);
    });

    it('still records the commit when the broadcast throws', async () => {
        // The write succeeded, so a socket server that has gone away must not
        // make the block look uncommitted.
        const broadcast = vi.fn(() => { throw new Error('socket gone'); });
        const { committer, observers } = createCommitter({ broadcast });

        committer.submit(buildPrepared(100, [buildTransaction('tx-1')]));
        await settle();

        expect(observers.notifyBlock).toHaveBeenCalledTimes(1);
        expect(committer.getMetrics().lastCommittedBlockNumber).toBe(100);
        expect(committer.getMetrics().failures).toBe(0);
    });

    it('hands chain data to its sink after the write, never before', async () => {
        // The ClickHouse copy must describe committed blocks only, so its
        // height matches every other surface.
        const { committer, calls } = createCommitter({
            chainData: { submit: vi.fn(() => { calls.push('chainData'); }) }
        });
        const prepared = buildPrepared(100, []);
        prepared.chainData = { blockNumber: 100, blockTimestamp: '', tables: {} };

        committer.submit(prepared);
        await settle();

        expect(calls.indexOf('persist:100')).toBeLessThan(calls.indexOf('chainData'));
    });

    it('hands no chain data on when the write fails', async () => {
        const submit = vi.fn();
        const { committer } = createCommitter({
            persist: vi.fn(async () => { throw new Error('mongo gone'); }),
            chainData: { submit }
        });
        const prepared = buildPrepared(100, []);
        prepared.chainData = { blockNumber: 100, blockTimestamp: '', tables: {} };

        committer.submit(prepared);
        await settle();

        expect(submit).not.toHaveBeenCalled();
    });

    it('still commits when the chain data sink throws', async () => {
        // ClickHouse is a copy; a fault there must not make a written block
        // look uncommitted.
        const { committer } = createCommitter({
            chainData: { submit: vi.fn(() => { throw new Error('sink broken'); }) }
        });
        const prepared = buildPrepared(100, []);
        prepared.chainData = { blockNumber: 100, blockTimestamp: '', tables: {} };

        committer.submit(prepared);
        await settle();

        expect(committer.getMetrics().lastCommittedBlockNumber).toBe(100);
        expect(committer.getMetrics().failures).toBe(0);
    });

    it('reports its backlog so a slow write is visible', async () => {
        // The emitter reports blocks waiting for a slot. This reports blocks
        // given a slot and still being written, which is the only symptom of
        // committing falling behind the release clock.
        const { committer } = createCommitter();

        committer.submit(buildPrepared(100, []));
        expect(committer.getMetrics().queued).toBe(1);

        await settle();
        expect(committer.getMetrics().queued).toBe(0);
    });
});
