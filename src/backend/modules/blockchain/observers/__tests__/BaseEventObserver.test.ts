/// <reference types="vitest" />

/**
 * Unit tests for the event observer base class.
 *
 * Plugins extend it to follow token movements, so its queue, statistics, and
 * stop behaviour must match the other observer kinds the `/system` observer
 * table already reads.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IContractEventBatch, IObservedContractEvent, ISystemLogService } from '@/types';
import { BaseEventObserver } from '../BaseEventObserver.js';

/**
 * Build a logger whose methods are spies.
 *
 * @returns A logger stub satisfying the base class constructor.
 */
function createLogger(): ISystemLogService {
    const logger = { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as Record<string, unknown>;
    logger.child = vi.fn(() => logger);

    return logger as unknown as ISystemLogService;
}

/**
 * Concrete observer recording what it processed, with a switch to fail.
 */
class TestEventObserver extends BaseEventObserver {
    protected readonly name = 'TestEventObserver';
    public processed: IContractEventBatch[] = [];
    public fail = false;

    /**
     * Record the batch, or throw when `fail` is set.
     *
     * @param batch - The batch being processed.
     */
    protected async processEvents(batch: IContractEventBatch): Promise<void> {
        if (this.fail) {
            throw new Error('processing failed');
        }
        this.processed.push(batch);
    }
}

/**
 * Build a batch with a given number of placeholder events.
 *
 * @param blockNumber - Block the batch belongs to.
 * @param eventCount - How many events it carries.
 * @param receiptsFetched - Whether the block's receipts were complete.
 * @returns The batch.
 */
function batch(blockNumber: number, eventCount: number, receiptsFetched = true): IContractEventBatch {
    const events = Array.from({ length: eventCount }, () => ({}) as IObservedContractEvent);

    return { blockNumber, blockTimestamp: new Date(0), receiptsFetched, events };
}

/**
 * Let the observer's queue drain.
 *
 * @returns A promise resolving after pending microtasks.
 */
async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('BaseEventObserver', () => {
    it('processes batches in order and counts events rather than batches', async () => {
        const observer = new TestEventObserver(createLogger());

        await observer.enqueueEvents(batch(1, 3));
        await observer.enqueueEvents(batch(2, 1));
        await settle();

        expect(observer.processed.map(item => item.blockNumber)).toEqual([1, 2]);
        expect(observer.getStats()).toMatchObject({ totalProcessed: 4, batchesProcessed: 2, avgBatchSize: 2, maxBatchSize: 3 });
    });

    it('hands gap batches to the subclass without counting them as work', async () => {
        const observer = new TestEventObserver(createLogger());

        await observer.enqueueEvents(batch(1, 0, false));
        await settle();

        expect(observer.processed).toHaveLength(1);
        expect(observer.getStats()).toMatchObject({ totalProcessed: 0, batchesProcessed: 0 });
    });

    it('counts a failed batch and keeps processing the next one', async () => {
        const observer = new TestEventObserver(createLogger());
        observer.fail = true;
        await observer.enqueueEvents(batch(1, 2));
        await settle();

        observer.fail = false;
        await observer.enqueueEvents(batch(2, 1));
        await settle();

        expect(observer.processed.map(item => item.blockNumber)).toEqual([2]);
        expect(observer.getStats()).toMatchObject({ totalErrors: 1, errorRate: 0.5 });
    });

    it('stops accepting and processing work once stopped', async () => {
        const observer = new TestEventObserver(createLogger());

        observer.stop();
        await observer.enqueueEvents(batch(1, 2));
        await settle();

        expect(observer.processed).toEqual([]);
    });
});
