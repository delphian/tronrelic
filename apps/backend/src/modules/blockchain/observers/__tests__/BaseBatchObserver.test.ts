/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService, ITransaction, IObserverStats, TransactionBatches } from '@tronrelic/types';
import { BaseBatchObserver } from '../BaseBatchObserver.js';

/**
 * Mock logger implementation for testing.
 *
 * Provides a complete ISystemLogService interface with spy functions to verify
 * that the observer logs appropriate messages during operation.
 */
class MockLogger implements ISystemLogService {
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>): ISystemLogService => this);

    public level = 'info';
    public async initialize() {}
    public async saveLog() {}
    public async getLogs() { return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false }; }
    public async markAsResolved() {}
    public async cleanup() { return 0; }
    public async getStatistics() { return { total: 0, byLevel: {} as any, byService: {}, unresolved: 0 }; }
    public async getLogById() { return null; }
    public async markAsUnresolved() { return null; }
    public async deleteAllLogs() { return 0; }
    public async getStats() { return { total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 }; }

    public reset(): void {
        this.fatal.mockClear();
        this.error.mockClear();
        this.warn.mockClear();
        this.info.mockClear();
        this.debug.mockClear();
        this.trace.mockClear();
    }
}

/**
 * Concrete implementation of BaseBatchObserver for testing.
 *
 * Tracks processed batches and allows configurable behavior for testing
 * error handling and statistics.
 */
class TestBatchObserver extends BaseBatchObserver {
    protected readonly name = 'TestBatchObserver';
    public processedBatches: TransactionBatches[] = [];
    private shouldThrowError = false;
    private processingDelayMs = 0;

    public setThrowError(shouldThrow: boolean): void {
        this.shouldThrowError = shouldThrow;
    }

    public setProcessingDelay(delayMs: number): void {
        this.processingDelayMs = delayMs;
    }

    protected async processBatch(batches: TransactionBatches): Promise<void> {
        if (this.processingDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.processingDelayMs));
        }

        if (this.shouldThrowError) {
            throw new Error('Test error from batch processing');
        }

        // Deep copy the batches
        const copy: TransactionBatches = {};
        for (const [type, transactions] of Object.entries(batches)) {
            copy[type] = [...transactions];
        }
        this.processedBatches.push(copy);
    }

    public clearProcessed(): void {
        this.processedBatches = [];
    }

    /**
     * Helper to count total transactions across all processed batches.
     */
    public getTotalTransactionCount(): number {
        return this.processedBatches.reduce((total, batch) =>
            total + Object.values(batch).reduce((sum, arr) => sum + arr.length, 0), 0);
    }

    /**
     * Helper to get all transactions of a specific type from processed batches.
     */
    public getTransactionsOfType(type: string): ITransaction[] {
        const result: ITransaction[] = [];
        for (const batch of this.processedBatches) {
            if (batch[type]) {
                result.push(...batch[type]);
            }
        }
        return result;
    }
}

/**
 * Create a mock transaction for testing.
 *
 * @param type - Transaction type (e.g., 'TransferContract')
 * @param txId - Optional transaction ID (defaults to auto-generated)
 * @returns Mock transaction object
 */
function createMockTransaction(type: string, txId?: string): ITransaction {
    return {
        payload: {
            type: type,
            txId: txId || `tx_${Math.random().toString(36).substr(2, 9)}`,
            blockNumber: 12345,
            timestamp: new Date(),
            from: { address: 'TMockFromAddress' },
            to: { address: 'TMockToAddress' },
            amount: 1000000
        },
        snapshot: {},
        categories: {
            isDelegation: false,
            isStake: false,
            isTokenCreation: false
        },
        rawValue: {},
        info: null
    };
}

/**
 * Create an array of mock transactions.
 *
 * @param count - Number of transactions to create
 * @param type - Transaction type
 * @returns Array of mock transactions
 */
function createMockTransactionArray(count: number, type: string = 'TransferContract'): ITransaction[] {
    return Array.from({ length: count }, (_, i) =>
        createMockTransaction(type, `batch_tx_${i}`)
    );
}

/**
 * Create a TransactionBatches object for testing.
 *
 * @param count - Number of transactions to create
 * @param type - Transaction type
 * @returns TransactionBatches object with single type
 */
function createMockBatch(count: number, type: string = 'TransferContract'): TransactionBatches {
    return {
        [type]: createMockTransactionArray(count, type)
    };
}

/**
 * Create a multi-type TransactionBatches object for testing.
 *
 * @param typeCounts - Object mapping transaction types to counts
 * @returns TransactionBatches with multiple types
 */
function createMultiTypeBatch(typeCounts: Record<string, number>): TransactionBatches {
    const batches: TransactionBatches = {};
    for (const [type, count] of Object.entries(typeCounts)) {
        batches[type] = createMockTransactionArray(count, type);
    }
    return batches;
}

describe('BaseBatchObserver', () => {
    let observer: TestBatchObserver;
    let mockLogger: MockLogger;

    beforeEach(() => {
        mockLogger = new MockLogger();
        observer = new TestBatchObserver(mockLogger);
    });

    describe('Constructor and Basic Properties', () => {
        it('should initialize with correct name', () => {
            expect(observer.getName()).toBe('TestBatchObserver');
        });

        it('should initialize with empty queue and zero stats', () => {
            const stats = observer.getStats();

            expect(stats.name).toBe('TestBatchObserver');
            expect(stats.queueDepth).toBe(0);
            expect(stats.totalProcessed).toBe(0);
            expect(stats.totalErrors).toBe(0);
            expect(stats.totalDropped).toBe(0);
            expect(stats.batchesProcessed).toBe(0);
            expect(stats.avgBatchSize).toBe(0);
            expect(stats.maxBatchSize).toBe(0);
        });
    });

    describe('Batch Enqueueing', () => {
        it('should enqueue and process a batch of transactions', async () => {
            const batch = createMockBatch(5);

            await observer.enqueueBatch(batch);

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(observer.processedBatches).toHaveLength(1);
            expect(observer.getTransactionsOfType('TransferContract')).toHaveLength(5);
        });

        it('should process multiple batches serially', async () => {
            const batch1 = createMockBatch(3);
            const batch2 = createMockBatch(5);
            const batch3 = createMockBatch(2);

            await observer.enqueueBatch(batch1);
            await observer.enqueueBatch(batch2);
            await observer.enqueueBatch(batch3);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(observer.processedBatches).toHaveLength(3);
            expect(observer.getTotalTransactionCount()).toBe(10); // 3 + 5 + 2
        });

        it('should handle empty batches gracefully', async () => {
            await observer.enqueueBatch({});

            await new Promise(resolve => setTimeout(resolve, 50));

            // Empty batches are skipped in processQueue
            expect(observer.processedBatches).toHaveLength(0);
        });

        it('should skip already processing batches', async () => {
            observer.setProcessingDelay(100);
            const batch1 = createMockBatch(2);
            const batch2 = createMockBatch(2);

            // Start first batch processing
            await observer.enqueueBatch(batch1);
            // Queue second batch while first is processing
            await observer.enqueueBatch(batch2);

            // Wait for all processing to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            expect(observer.processedBatches).toHaveLength(2);
        });

        it('should handle multi-type batches', async () => {
            const batch = createMultiTypeBatch({
                'DelegateResourceContract': 3,
                'UnDelegateResourceContract': 2
            });

            await observer.enqueueBatch(batch);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(observer.processedBatches).toHaveLength(1);
            expect(observer.getTransactionsOfType('DelegateResourceContract')).toHaveLength(3);
            expect(observer.getTransactionsOfType('UnDelegateResourceContract')).toHaveLength(2);
            expect(observer.getTotalTransactionCount()).toBe(5);
        });
    });

    describe('Single Transaction Enqueue (IBaseObserver compatibility)', () => {
        it('should wrap single transaction in batch via enqueue()', async () => {
            const transaction = createMockTransaction('TransferContract', 'single_tx');

            await observer.enqueue(transaction);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(observer.processedBatches).toHaveLength(1);
            const transactions = observer.getTransactionsOfType('TransferContract');
            expect(transactions).toHaveLength(1);
            expect(transactions[0].payload.txId).toBe('single_tx');
        });
    });

    describe('Statistics Tracking', () => {
        it('should track total processed transactions', async () => {
            const batch1 = createMockBatch(3);
            const batch2 = createMockBatch(5);

            await observer.enqueueBatch(batch1);
            await observer.enqueueBatch(batch2);

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.totalProcessed).toBe(8); // 3 + 5
        });

        it('should track batches processed count', async () => {
            await observer.enqueueBatch(createMockBatch(2));
            await observer.enqueueBatch(createMockBatch(3));
            await observer.enqueueBatch(createMockBatch(1));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.batchesProcessed).toBe(3);
        });

        it('should calculate average batch size', async () => {
            await observer.enqueueBatch(createMockBatch(2)); // 2
            await observer.enqueueBatch(createMockBatch(4)); // 4
            await observer.enqueueBatch(createMockBatch(6)); // 6

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.avgBatchSize).toBe(4); // (2 + 4 + 6) / 3 = 4
        });

        it('should track max batch size', async () => {
            await observer.enqueueBatch(createMockBatch(3));
            await observer.enqueueBatch(createMockBatch(10));
            await observer.enqueueBatch(createMockBatch(5));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.maxBatchSize).toBe(10);
        });

        it('should track processing time', async () => {
            observer.setProcessingDelay(20);

            await observer.enqueueBatch(createMockBatch(2));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            // Use 15ms threshold to allow for timer jitter on CI runners
            expect(stats.avgProcessingTimeMs).toBeGreaterThanOrEqual(15);
            expect(stats.minProcessingTimeMs).toBeGreaterThanOrEqual(15);
            expect(stats.maxProcessingTimeMs).toBeGreaterThanOrEqual(15);
        });

        it('should update lastProcessedAt timestamp', async () => {
            const beforeProcess = new Date();

            await observer.enqueueBatch(createMockBatch(1));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats = observer.getStats();
            expect(stats.lastProcessedAt).not.toBeNull();

            const processedAt = new Date(stats.lastProcessedAt!);
            expect(processedAt.getTime()).toBeGreaterThanOrEqual(beforeProcess.getTime());
        });
    });

    describe('Error Handling', () => {
        it('should log error and continue processing on batch failure', async () => {
            observer.setThrowError(true);

            await observer.enqueueBatch(createMockBatch(3));

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    observer: 'TestBatchObserver',
                    batchSize: 3
                }),
                'Batch observer failed to process batch - continuing with next batch'
            );
        });

        it('should track error count', async () => {
            observer.setThrowError(true);

            await observer.enqueueBatch(createMockBatch(2));
            await observer.enqueueBatch(createMockBatch(3));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.totalErrors).toBe(2);
        });

        it('should update lastErrorAt timestamp on error', async () => {
            observer.setThrowError(true);

            await observer.enqueueBatch(createMockBatch(1));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats = observer.getStats();
            expect(stats.lastErrorAt).not.toBeNull();
        });

        it('should calculate error rate correctly', async () => {
            // Process one batch successfully
            await observer.enqueueBatch(createMockBatch(2));
            await new Promise(resolve => setTimeout(resolve, 50));

            // Then fail one batch
            observer.setThrowError(true);
            await observer.enqueueBatch(createMockBatch(2));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats = observer.getStats();
            expect(stats.errorRate).toBe(0.5); // 1 error / 2 total batches
        });

        it('should continue processing subsequent batches after error', async () => {
            // First batch will succeed
            await observer.enqueueBatch(createMockBatch(2));

            // Enable error for second batch
            observer.setThrowError(true);
            await observer.enqueueBatch(createMockBatch(2));

            // Disable error for third batch
            observer.setThrowError(false);
            await observer.enqueueBatch(createMockBatch(2));

            await new Promise(resolve => setTimeout(resolve, 150));

            // First and third batches should be processed
            expect(observer.processedBatches).toHaveLength(2);
            expect(observer.getStats().totalErrors).toBe(1);
        });
    });

    describe('Queue Overflow Protection', () => {
        it('should drop incoming batch and log error when queue is at MAX_QUEUE_SIZE', async () => {
            // Set processing delay to allow queue to fill
            observer.setProcessingDelay(5000);

            // Enqueue first batch to start slow processing
            await observer.enqueueBatch(createMockBatch(1));

            // Fill queue to max (100 batches)
            for (let i = 0; i < 100; i++) {
                await observer.enqueueBatch(createMockBatch(1));
            }

            // This batch should be dropped (queue is now at 100)
            await observer.enqueueBatch(createMockBatch(3));

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    observer: 'TestBatchObserver',
                    droppedBatches: 1,
                    droppedTransactions: 3
                }),
                'Batch observer queue overflow - dropping incoming batch to prevent memory issues'
            );
        });

        it('should track dropped transactions count on overflow', async () => {
            observer.setProcessingDelay(5000);

            // Start processing
            await observer.enqueueBatch(createMockBatch(5));

            // Fill queue to max (100 batches)
            for (let i = 0; i < 100; i++) {
                await observer.enqueueBatch(createMockBatch(1));
            }

            // This batch of 4 transactions should be dropped
            await observer.enqueueBatch(createMockBatch(4));

            const stats = observer.getStats();
            expect(stats.totalDropped).toBe(4);
        });

        it('should preserve existing queue when dropping incoming batch', async () => {
            observer.setProcessingDelay(5000);

            // Start processing first batch
            await observer.enqueueBatch(createMockBatch(1));

            // Fill queue to max
            for (let i = 0; i < 100; i++) {
                await observer.enqueueBatch(createMockBatch(1));
            }

            // Queue depth should still be 100 (not cleared)
            const stats = observer.getStats();
            expect(stats.queueDepth).toBe(100);
        });
    });

    describe('Concurrent Operations', () => {
        it('should handle rapid batch enqueueing', async () => {
            const batchPromises = Array.from({ length: 20 }, (_, i) =>
                observer.enqueueBatch(createMockBatch(2))
            );

            await Promise.all(batchPromises);
            await new Promise(resolve => setTimeout(resolve, 200));

            expect(observer.processedBatches.length).toBe(20);
            expect(observer.getStats().totalProcessed).toBe(40); // 20 batches * 2 transactions
        });

        it('should maintain queue depth accuracy under concurrent operations', async () => {
            observer.setProcessingDelay(10);

            // Enqueue several batches
            for (let i = 0; i < 5; i++) {
                await observer.enqueueBatch(createMockBatch(2));
            }

            // Wait for all to complete
            await new Promise(resolve => setTimeout(resolve, 200));

            const stats = observer.getStats();
            expect(stats.queueDepth).toBe(0);
            expect(stats.batchesProcessed).toBe(5);
        });
    });

    describe('Stats Return Structure', () => {
        it('should return all required IObserverStats fields', async () => {
            await observer.enqueueBatch(createMockBatch(5));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats: IObserverStats = observer.getStats();

            // Base IObserverStats fields
            expect(stats).toHaveProperty('name');
            expect(stats).toHaveProperty('queueDepth');
            expect(stats).toHaveProperty('totalProcessed');
            expect(stats).toHaveProperty('totalErrors');
            expect(stats).toHaveProperty('totalDropped');
            expect(stats).toHaveProperty('avgProcessingTimeMs');
            expect(stats).toHaveProperty('minProcessingTimeMs');
            expect(stats).toHaveProperty('maxProcessingTimeMs');
            expect(stats).toHaveProperty('lastProcessedAt');
            expect(stats).toHaveProperty('lastErrorAt');
            expect(stats).toHaveProperty('errorRate');

            // Batch-specific fields
            expect(stats).toHaveProperty('batchesProcessed');
            expect(stats).toHaveProperty('avgBatchSize');
            expect(stats).toHaveProperty('maxBatchSize');
        });

        it('should return correct types for stats fields', async () => {
            await observer.enqueueBatch(createMockBatch(3));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats = observer.getStats();

            expect(typeof stats.name).toBe('string');
            expect(typeof stats.queueDepth).toBe('number');
            expect(typeof stats.totalProcessed).toBe('number');
            expect(typeof stats.batchesProcessed).toBe('number');
            expect(typeof stats.avgBatchSize).toBe('number');
            expect(typeof stats.maxBatchSize).toBe('number');
        });
    });
});
