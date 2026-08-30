/**
 * Unit tests for writing a released block and telling everything about it.
 *
 * Four properties matter here, and each fails silently in production if it
 * regresses. The write must happen before anything is told about the block, or a
 * client that hears about a height and queries for it finds nothing. Commits
 * must be serialized, because they advance a shared cursor and drive a batch
 * accumulator shared across blocks. A failed write must not announce the block,
 * since the cursor did not advance and the next tick will fetch it again. And
 * nothing may throw, because a commit starts inside the emitter's timer callback
 * where an escaping error kills the release clock.
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
        notifyBlock: vi.fn(async () => { calls.push('notifyBlock'); })
    } as unknown as IBlockchainObserverService;

    const persist = vi.fn(async (prepared: IPreparedBlock) => { calls.push(`persist:${prepared.blockNumber}`); });
    const alerts = { ingestTransactions: vi.fn(async () => { calls.push('alerts'); }) };
    const broadcast = vi.fn(() => { calls.push('broadcast'); });

    const deps: IBlockCommitterDependencies = { persist, observers, alerts, broadcast, ...overrides };

    return { committer: new BlockCommitter(deps), persist, observers, alerts, broadcast, calls };
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
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(alerts.ingestTransactions).toHaveBeenCalledWith([transactions[0].payload, transactions[1].payload]);
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

    it('keeps committing later blocks after one fails', async () => {
        // A single bad block must not wedge the chain behind it, or one failure
        // stops the pipeline permanently.
        let attempt = 0;
        const persist = vi.fn(async (prepared: IPreparedBlock) => {
            attempt += 1;
            if (attempt === 1) {
                throw new Error('transient');
            }
            return undefined;
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
