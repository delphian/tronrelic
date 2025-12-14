/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IBaseObserver, IBaseBatchObserver, IBaseBlockObserver, IBlockData, IObserverStats, ISystemLogService, ITransaction } from '@tronrelic/types';
import { BlockchainObserverService } from '../blockchain-observer.service.js';

/**
 * Mock logger implementation for testing.
 *
 * Provides a complete ISystemLogService interface with spy functions to verify
 * that the service logs appropriate messages during operation.
 */
class MockLogger implements ISystemLogService {
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>): ISystemLogService => {
        return this;
    });

    // Additional ISystemLogService properties (not used in tests, so just return dummy values)
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
}

/**
 * Mock observer implementation for testing.
 *
 * Implements IBaseObserver with tracking for enqueued transactions
 * and configurable behavior (success, error, queue overflow).
 */
class MockObserver implements IBaseObserver {
    private enqueuedTransactions: ITransaction[] = [];
    private shouldThrowError = false;
    private mockStats: IObserverStats;

    constructor(
        private name: string,
        private throwError = false
    ) {
        this.shouldThrowError = throwError;
        this.mockStats = {
            name: this.name,
            queueDepth: 0,
            totalProcessed: 0,
            totalErrors: 0,
            totalDropped: 0,
            avgProcessingTimeMs: 0,
            minProcessingTimeMs: 0,
            maxProcessingTimeMs: 0,
            lastProcessedAt: null,
            lastErrorAt: null,
            errorRate: 0
        };
    }

    public getName(): string {
        return this.name;
    }

    public async enqueue(transaction: ITransaction): Promise<void> {
        if (this.shouldThrowError) {
            throw new Error(`Mock error from ${this.name}`);
        }
        this.enqueuedTransactions.push(transaction);
        this.mockStats.queueDepth = this.enqueuedTransactions.length;
        this.mockStats.totalProcessed++;
    }

    public getStats(): IObserverStats {
        return this.mockStats;
    }

    public getEnqueuedTransactions(): ITransaction[] {
        return this.enqueuedTransactions;
    }

    public setStats(stats: Partial<IObserverStats>): void {
        this.mockStats = { ...this.mockStats, ...stats };
    }

    public clearEnqueued(): void {
        this.enqueuedTransactions = [];
        this.mockStats.queueDepth = 0;
    }
}

/**
 * Create a mock transaction for testing.
 *
 * Generates a minimal ITransaction object with the specified type
 * to test observer subscription and notification behavior.
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
            from: {
                address: 'TMockFromAddress'
            },
            to: {
                address: 'TMockToAddress'
            },
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

describe('BlockchainObserverService', () => {
    let service: BlockchainObserverService;
    let mockLogger: MockLogger;

    beforeEach(() => {
        // Reset singleton before each test
        BlockchainObserverService.resetForTesting();
        mockLogger = new MockLogger();
        service = BlockchainObserverService.initialize(mockLogger);
    });

    afterEach(() => {
        // Clean up singleton after each test
        BlockchainObserverService.resetForTesting();
    });

    describe('Singleton Pattern', () => {
        it('should create singleton instance on initialize', () => {
            expect(service).toBeInstanceOf(BlockchainObserverService);
            expect(mockLogger.info).toHaveBeenCalledWith('Blockchain observer service initialized');
        });

        it('should return same instance on subsequent getInstance calls', () => {
            const instance1 = BlockchainObserverService.getInstance();
            const instance2 = BlockchainObserverService.getInstance();
            expect(instance1).toBe(instance2);
            expect(instance1).toBe(service);
        });

        it('should throw error if getInstance called before initialize', () => {
            BlockchainObserverService.resetForTesting();
            expect(() => BlockchainObserverService.getInstance()).toThrow(
                'BlockchainObserverService not initialized'
            );
        });

        it('should allow logger updates after initialization', () => {
            const newLogger = new MockLogger();
            const updatedService = BlockchainObserverService.initialize(newLogger);

            expect(updatedService).toBe(service);
            // Logger is updated but initialization log is not called again since instance already exists
            expect(newLogger.info).not.toHaveBeenCalled();
        });
    });

    describe('Observer Subscription', () => {
        it('should subscribe observer to transaction type', () => {
            const observer = new MockObserver('test-observer');

            service.subscribeTransactionType('TransferContract', observer);

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    transactionType: 'TransferContract',
                    observerName: 'test-observer',
                    totalSubscribers: 1
                }),
                'Observer subscribed to transaction type'
            );
        });

        it('should allow multiple observers for same transaction type', () => {
            const observer1 = new MockObserver('observer-1');
            const observer2 = new MockObserver('observer-2');

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TransferContract', observer2);

            const stats = service.getSubscriptionStats();
            expect(stats['TransferContract']).toBe(2);
        });

        it('should track subscriptions across multiple transaction types', () => {
            const observer1 = new MockObserver('observer-1');
            const observer2 = new MockObserver('observer-2');

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TriggerSmartContract', observer2);

            const stats = service.getSubscriptionStats();
            expect(stats['TransferContract']).toBe(1);
            expect(stats['TriggerSmartContract']).toBe(1);
        });

        it('should handle same observer subscribing to multiple types', () => {
            const observer = new MockObserver('multi-type-observer');

            service.subscribeTransactionType('TransferContract', observer);
            service.subscribeTransactionType('TriggerSmartContract', observer);

            const stats = service.getSubscriptionStats();
            expect(stats['TransferContract']).toBe(1);
            expect(stats['TriggerSmartContract']).toBe(1);
        });
    });

    describe('Transaction Notification', () => {
        it('should notify subscribed observers of matching transactions', async () => {
            const observer = new MockObserver('transfer-observer');
            service.subscribeTransactionType('TransferContract', observer);

            const transaction = createMockTransaction('TransferContract', 'tx123');
            await service.notifyTransaction(transaction);

            // Give async notification time to complete
            await new Promise(resolve => setTimeout(resolve, 10));

            const enqueued = observer.getEnqueuedTransactions();
            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].payload.txId).toBe('tx123');
        });

        it('should not notify observers of non-matching transaction types', async () => {
            const observer = new MockObserver('transfer-observer');
            service.subscribeTransactionType('TransferContract', observer);

            const transaction = createMockTransaction('TriggerSmartContract', 'tx456');
            await service.notifyTransaction(transaction);

            await new Promise(resolve => setTimeout(resolve, 10));

            const enqueued = observer.getEnqueuedTransactions();
            expect(enqueued).toHaveLength(0);
        });

        it('should notify all subscribed observers', async () => {
            const observer1 = new MockObserver('observer-1');
            const observer2 = new MockObserver('observer-2');

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TransferContract', observer2);

            const transaction = createMockTransaction('TransferContract', 'tx789');
            await service.notifyTransaction(transaction);

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(observer1.getEnqueuedTransactions()).toHaveLength(1);
            expect(observer2.getEnqueuedTransactions()).toHaveLength(1);
        });

        it('should handle observer errors without failing notification', async () => {
            const goodObserver = new MockObserver('good-observer');
            const badObserver = new MockObserver('bad-observer', true);

            service.subscribeTransactionType('TransferContract', goodObserver);
            service.subscribeTransactionType('TransferContract', badObserver);

            const transaction = createMockTransaction('TransferContract', 'tx-error');
            await service.notifyTransaction(transaction);

            await new Promise(resolve => setTimeout(resolve, 10));

            // Good observer should still receive transaction
            expect(goodObserver.getEnqueuedTransactions()).toHaveLength(1);

            // Error should be logged
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    observer: 'bad-observer',
                    txId: 'tx-error'
                }),
                'Failed to enqueue transaction to observer'
            );
        });

        it('should return immediately without awaiting observers (fire-and-forget)', async () => {
            const observer = new MockObserver('slow-observer');
            service.subscribeTransactionType('TransferContract', observer);

            const transaction = createMockTransaction('TransferContract', 'tx-fast');

            const startTime = Date.now();
            await service.notifyTransaction(transaction);
            const duration = Date.now() - startTime;

            // Should return almost immediately (< 50ms)
            expect(duration).toBeLessThan(50);
        });
    });

    describe('Statistics and Monitoring', () => {
        it('should return empty subscription stats when no observers', () => {
            const stats = service.getSubscriptionStats();
            expect(stats).toEqual({});
        });

        it('should return correct subscription counts', () => {
            const observer1 = new MockObserver('observer-1');
            const observer2 = new MockObserver('observer-2');
            const observer3 = new MockObserver('observer-3');

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TransferContract', observer2);
            service.subscribeTransactionType('TriggerSmartContract', observer3);

            const stats = service.getSubscriptionStats();
            expect(stats).toEqual({
                'TransferContract': 2,
                'TriggerSmartContract': 1
            });
        });

        it('should collect stats from all observers', () => {
            const observer1 = new MockObserver('observer-1');
            const observer2 = new MockObserver('observer-2');

            observer1.setStats({ totalProcessed: 100, totalErrors: 5 });
            observer2.setStats({ totalProcessed: 50, totalErrors: 2 });

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TriggerSmartContract', observer2);

            const allStats = service.getAllObserverStats();
            expect(allStats).toHaveLength(2);
            expect(allStats[0].name).toBe('observer-1');
            expect(allStats[1].name).toBe('observer-2');
        });

        it('should deduplicate observers subscribed to multiple types', () => {
            const observer = new MockObserver('multi-type');

            service.subscribeTransactionType('TransferContract', observer);
            service.subscribeTransactionType('TriggerSmartContract', observer);

            const allStats = service.getAllObserverStats();
            expect(allStats).toHaveLength(1);
            expect(allStats[0].name).toBe('multi-type');
        });

        it('should calculate correct aggregate statistics', () => {
            const observer1 = new MockObserver('observer-1');
            const observer2 = new MockObserver('observer-2');

            observer1.setStats({
                totalProcessed: 100,
                totalErrors: 5,
                totalDropped: 2,
                queueDepth: 10,
                avgProcessingTimeMs: 50,
                errorRate: 0.05
            });

            observer2.setStats({
                totalProcessed: 200,
                totalErrors: 10,
                totalDropped: 3,
                queueDepth: 15,
                avgProcessingTimeMs: 30,
                errorRate: 0.05
            });

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TriggerSmartContract', observer2);

            const aggregate = service.getAggregateStats();

            expect(aggregate.totalObservers).toBe(2);
            expect(aggregate.totalProcessed).toBe(300);
            expect(aggregate.totalErrors).toBe(15);
            expect(aggregate.totalDropped).toBe(5);
            expect(aggregate.totalQueueDepth).toBe(25);
            expect(aggregate.avgProcessingTimeMs).toBe(40); // (50 + 30) / 2
            expect(aggregate.highestErrorRate).toBe(0.05);
            expect(aggregate.observersWithErrors).toBe(2);
        });

        it('should handle aggregate stats with no observers', () => {
            const aggregate = service.getAggregateStats();

            expect(aggregate.totalObservers).toBe(0);
            expect(aggregate.totalProcessed).toBe(0);
            expect(aggregate.totalErrors).toBe(0);
            expect(aggregate.avgProcessingTimeMs).toBe(0);
        });

        it('should return health status with observer count and subscriptions', () => {
            const observer1 = new MockObserver('observer-1');
            const observer2 = new MockObserver('observer-2');

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TriggerSmartContract', observer2);

            const health = service.getHealthStatus();

            expect(health.totalObservers).toBe(2);
            expect(health.subscriptions).toEqual({
                'TransferContract': 1,
                'TriggerSmartContract': 1
            });
        });
    });

    describe('Edge Cases and Error Handling', () => {
        it('should handle notification with no subscribers', async () => {
            const transaction = createMockTransaction('UnknownContract', 'tx-no-sub');

            // Should not throw
            await expect(service.notifyTransaction(transaction)).resolves.toBeUndefined();
        });

        it('should handle multiple rapid notifications', async () => {
            const observer = new MockObserver('rapid-observer');
            service.subscribeTransactionType('TransferContract', observer);

            const transactions = Array.from({ length: 100 }, (_, i) =>
                createMockTransaction('TransferContract', `tx-${i}`)
            );

            await Promise.all(transactions.map(tx => service.notifyTransaction(tx)));
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(observer.getEnqueuedTransactions().length).toBe(100);
        });

        it('should isolate errors from one observer affecting others', async () => {
            const observer1 = new MockObserver('observer-1', false);
            const observer2 = new MockObserver('observer-2', true); // throws error
            const observer3 = new MockObserver('observer-3', false);

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TransferContract', observer2);
            service.subscribeTransactionType('TransferContract', observer3);

            const transaction = createMockTransaction('TransferContract', 'tx-isolation');
            await service.notifyTransaction(transaction);

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(observer1.getEnqueuedTransactions()).toHaveLength(1);
            expect(observer3.getEnqueuedTransactions()).toHaveLength(1);
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should calculate average processing time only for observers with processing', () => {
            const observer1 = new MockObserver('processed');
            const observer2 = new MockObserver('not-processed');

            observer1.setStats({ totalProcessed: 100, avgProcessingTimeMs: 50 });
            observer2.setStats({ totalProcessed: 0, avgProcessingTimeMs: 0 });

            service.subscribeTransactionType('TransferContract', observer1);
            service.subscribeTransactionType('TriggerSmartContract', observer2);

            const aggregate = service.getAggregateStats();
            expect(aggregate.avgProcessingTimeMs).toBe(50);
        });

        it('should handle resetForTesting correctly', () => {
            const observer = new MockObserver('test-observer');
            service.subscribeTransactionType('TransferContract', observer);

            expect(service.getSubscriptionStats()).toEqual({ 'TransferContract': 1 });

            BlockchainObserverService.resetForTesting();

            expect(() => BlockchainObserverService.getInstance()).toThrow();
        });
    });

    describe('Concurrent Operations', () => {
        it('should handle concurrent subscriptions safely', () => {
            const observers = Array.from({ length: 10 }, (_, i) =>
                new MockObserver(`observer-${i}`)
            );

            observers.forEach(observer => {
                service.subscribeTransactionType('TransferContract', observer);
            });

            const stats = service.getSubscriptionStats();
            expect(stats['TransferContract']).toBe(10);
        });

        it('should handle concurrent notifications safely', async () => {
            const observer = new MockObserver('concurrent-observer');
            service.subscribeTransactionType('TransferContract', observer);

            const notifications = Array.from({ length: 50 }, (_, i) =>
                service.notifyTransaction(createMockTransaction('TransferContract', `concurrent-${i}`))
            );

            await Promise.all(notifications);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(observer.getEnqueuedTransactions().length).toBe(50);
        });
    });

    // =========================================================================
    // Batch Observer Tests
    // =========================================================================

    describe('Batch Observer Subscription', () => {
        it('should subscribe batch observer to transaction type', () => {
            const batchObserver = new MockBatchObserver('batch-observer');

            service.subscribeTransactionTypeBatch('TransferContract', batchObserver);

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    transactionType: 'TransferContract',
                    observerName: 'batch-observer',
                    totalBatchSubscribers: 1
                }),
                'Batch observer subscribed to transaction type'
            );
        });

        it('should allow multiple batch observers for same transaction type', () => {
            const observer1 = new MockBatchObserver('batch-1');
            const observer2 = new MockBatchObserver('batch-2');

            service.subscribeTransactionTypeBatch('TransferContract', observer1);
            service.subscribeTransactionTypeBatch('TransferContract', observer2);

            const stats = service.getBatchSubscriptionStats();
            expect(stats['TransferContract']).toBe(2);
        });

        it('should track batch subscriptions separately from regular subscriptions', () => {
            const regularObserver = new MockObserver('regular');
            const batchObserver = new MockBatchObserver('batch');

            service.subscribeTransactionType('TransferContract', regularObserver);
            service.subscribeTransactionTypeBatch('TransferContract', batchObserver);

            expect(service.getSubscriptionStats()['TransferContract']).toBe(1);
            expect(service.getBatchSubscriptionStats()['TransferContract']).toBe(1);
        });
    });

    describe('Batch Accumulation and Flushing', () => {
        it('should accumulate transactions by type', () => {
            const tx1 = createMockTransaction('TransferContract', 'tx1');
            const tx2 = createMockTransaction('TransferContract', 'tx2');
            const tx3 = createMockTransaction('TriggerSmartContract', 'tx3');

            service.accumulateForBatch(tx1);
            service.accumulateForBatch(tx2);
            service.accumulateForBatch(tx3);

            // Verify accumulator contains transactions (internal state, tested via flush)
        });

        it('should clear batch accumulator', () => {
            const tx1 = createMockTransaction('TransferContract', 'tx1');
            service.accumulateForBatch(tx1);

            service.clearBatchAccumulator();

            // Verify by flushing - no notifications should occur
            const batchObserver = new MockBatchObserver('batch');
            service.subscribeTransactionTypeBatch('TransferContract', batchObserver);

            service.flushBatches();

            // No batch should be delivered after clear
            expect(batchObserver.getEnqueuedBatches()).toHaveLength(0);
        });

        it('should flush accumulated batches to batch observers', async () => {
            const batchObserver = new MockBatchObserver('batch-observer');
            service.subscribeTransactionTypeBatch('TransferContract', batchObserver);

            // Accumulate transactions
            service.accumulateForBatch(createMockTransaction('TransferContract', 'tx1'));
            service.accumulateForBatch(createMockTransaction('TransferContract', 'tx2'));
            service.accumulateForBatch(createMockTransaction('TransferContract', 'tx3'));

            await service.flushBatches();
            await new Promise(resolve => setTimeout(resolve, 10));

            const batches = batchObserver.getEnqueuedBatches();
            expect(batches).toHaveLength(1);
            expect(batches[0]).toHaveLength(3);
        });

        it('should flush different transaction types to their respective observers', async () => {
            const transferObserver = new MockBatchObserver('transfer-batch');
            const triggerObserver = new MockBatchObserver('trigger-batch');

            service.subscribeTransactionTypeBatch('TransferContract', transferObserver);
            service.subscribeTransactionTypeBatch('TriggerSmartContract', triggerObserver);

            service.accumulateForBatch(createMockTransaction('TransferContract', 'tx1'));
            service.accumulateForBatch(createMockTransaction('TransferContract', 'tx2'));
            service.accumulateForBatch(createMockTransaction('TriggerSmartContract', 'tx3'));

            await service.flushBatches();
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(transferObserver.getEnqueuedBatches()[0]).toHaveLength(2);
            expect(triggerObserver.getEnqueuedBatches()[0]).toHaveLength(1);
        });

        it('should clear accumulator after flush', async () => {
            const batchObserver = new MockBatchObserver('batch');
            service.subscribeTransactionTypeBatch('TransferContract', batchObserver);

            service.accumulateForBatch(createMockTransaction('TransferContract', 'tx1'));
            await service.flushBatches();
            await new Promise(resolve => setTimeout(resolve, 10));

            // Flush again - should be empty
            await service.flushBatches();
            await new Promise(resolve => setTimeout(resolve, 10));

            // Only one batch should have been delivered
            expect(batchObserver.getEnqueuedBatches()).toHaveLength(1);
        });

        it('should handle batch observer errors without affecting other observers', async () => {
            const goodObserver = new MockBatchObserver('good-batch');
            const badObserver = new MockBatchObserver('bad-batch', true);

            service.subscribeTransactionTypeBatch('TransferContract', goodObserver);
            service.subscribeTransactionTypeBatch('TransferContract', badObserver);

            service.accumulateForBatch(createMockTransaction('TransferContract', 'tx1'));
            await service.flushBatches();
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(goodObserver.getEnqueuedBatches()).toHaveLength(1);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    observer: 'bad-batch',
                    transactionType: 'TransferContract'
                }),
                'Failed to enqueue batch to observer'
            );
        });

        it('should not flush empty batches', async () => {
            const batchObserver = new MockBatchObserver('batch');
            service.subscribeTransactionTypeBatch('TransferContract', batchObserver);

            // Flush without accumulating anything
            await service.flushBatches();
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(batchObserver.getEnqueuedBatches()).toHaveLength(0);
        });
    });

    // =========================================================================
    // Block Observer Tests
    // =========================================================================

    describe('Block Observer Subscription', () => {
        it('should subscribe block observer', () => {
            const blockObserver = new MockBlockObserver('block-observer');

            service.subscribeBlock(blockObserver);

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    observerName: 'block-observer',
                    totalBlockSubscribers: 1
                }),
                'Block observer subscribed'
            );
        });

        it('should allow multiple block observers', () => {
            const observer1 = new MockBlockObserver('block-1');
            const observer2 = new MockBlockObserver('block-2');

            service.subscribeBlock(observer1);
            service.subscribeBlock(observer2);

            const stats = service.getBlockSubscriptionStats();
            expect(stats.subscriberCount).toBe(2);
        });
    });

    describe('Block Notification', () => {
        it('should notify block observers of completed blocks', async () => {
            const blockObserver = new MockBlockObserver('block-observer');
            service.subscribeBlock(blockObserver);

            const blockData = createMockBlockData(12345, 5);
            await service.notifyBlock(blockData);
            await new Promise(resolve => setTimeout(resolve, 10));

            const blocks = blockObserver.getEnqueuedBlocks();
            expect(blocks).toHaveLength(1);
            expect(blocks[0].blockNumber).toBe(12345);
            expect(blocks[0].transactions).toHaveLength(5);
        });

        it('should notify all subscribed block observers', async () => {
            const observer1 = new MockBlockObserver('block-1');
            const observer2 = new MockBlockObserver('block-2');

            service.subscribeBlock(observer1);
            service.subscribeBlock(observer2);

            const blockData = createMockBlockData(100, 3);
            await service.notifyBlock(blockData);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(observer1.getEnqueuedBlocks()).toHaveLength(1);
            expect(observer2.getEnqueuedBlocks()).toHaveLength(1);
        });

        it('should handle block observer errors without affecting other observers', async () => {
            const goodObserver = new MockBlockObserver('good-block');
            const badObserver = new MockBlockObserver('bad-block', true);

            service.subscribeBlock(goodObserver);
            service.subscribeBlock(badObserver);

            const blockData = createMockBlockData(100, 2);
            await service.notifyBlock(blockData);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(goodObserver.getEnqueuedBlocks()).toHaveLength(1);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    observer: 'bad-block',
                    blockNumber: 100
                }),
                'Failed to enqueue block to observer'
            );
        });

        it('should return immediately with no subscribers', async () => {
            const blockData = createMockBlockData(100, 5);

            const startTime = Date.now();
            await service.notifyBlock(blockData);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(50);
        });
    });

    // =========================================================================
    // Enhanced Statistics Tests
    // =========================================================================

    describe('Enhanced Statistics (includes batch and block observers)', () => {
        it('should include batch observers in getAllObserverStats', () => {
            const regularObserver = new MockObserver('regular');
            const batchObserver = new MockBatchObserver('batch');

            service.subscribeTransactionType('TransferContract', regularObserver);
            service.subscribeTransactionTypeBatch('TransferContract', batchObserver);

            const allStats = service.getAllObserverStats();
            expect(allStats).toHaveLength(2);

            const names = allStats.map(s => s.name);
            expect(names).toContain('regular');
            expect(names).toContain('batch');
        });

        it('should include block observers in getAllObserverStats', () => {
            const regularObserver = new MockObserver('regular');
            const blockObserver = new MockBlockObserver('block');

            service.subscribeTransactionType('TransferContract', regularObserver);
            service.subscribeBlock(blockObserver);

            const allStats = service.getAllObserverStats();
            expect(allStats).toHaveLength(2);

            const names = allStats.map(s => s.name);
            expect(names).toContain('regular');
            expect(names).toContain('block');
        });

        it('should deduplicate observers across all subscription types', () => {
            const observer = new MockObserver('multi-type');

            service.subscribeTransactionType('TransferContract', observer);
            service.subscribeTransactionType('TriggerSmartContract', observer);

            const allStats = service.getAllObserverStats();
            expect(allStats).toHaveLength(1);
        });

        it('should aggregate stats from all observer types', () => {
            const regular = new MockObserver('regular');
            const batch = new MockBatchObserver('batch');
            const block = new MockBlockObserver('block');

            regular.setStats({ totalProcessed: 100 });
            batch.setStats({ totalProcessed: 50 });
            block.setStats({ totalProcessed: 25 });

            service.subscribeTransactionType('TransferContract', regular);
            service.subscribeTransactionTypeBatch('TransferContract', batch);
            service.subscribeBlock(block);

            const aggregate = service.getAggregateStats();
            expect(aggregate.totalObservers).toBe(3);
            expect(aggregate.totalProcessed).toBe(175); // 100 + 50 + 25
        });
    });

    describe('Reset For Testing', () => {
        it('should clear batch and block subscriptions on reset', () => {
            const batchObserver = new MockBatchObserver('batch');
            const blockObserver = new MockBlockObserver('block');

            service.subscribeTransactionTypeBatch('TransferContract', batchObserver);
            service.subscribeBlock(blockObserver);

            expect(service.getBatchSubscriptionStats()['TransferContract']).toBe(1);
            expect(service.getBlockSubscriptionStats().subscriberCount).toBe(1);

            BlockchainObserverService.resetForTesting();

            // Re-initialize for next assertion
            service = BlockchainObserverService.initialize(mockLogger);

            expect(service.getBatchSubscriptionStats()).toEqual({});
            expect(service.getBlockSubscriptionStats().subscriberCount).toBe(0);
        });
    });
});

// =========================================================================
// Mock Classes for Batch and Block Observers
// =========================================================================

/**
 * Mock batch observer implementation for testing.
 */
class MockBatchObserver implements IBaseBatchObserver {
    private enqueuedBatches: ITransaction[][] = [];
    private shouldThrowError = false;
    private mockStats: IObserverStats;

    constructor(
        private name: string,
        throwError = false
    ) {
        this.shouldThrowError = throwError;
        this.mockStats = {
            name: this.name,
            queueDepth: 0,
            totalProcessed: 0,
            totalErrors: 0,
            totalDropped: 0,
            avgProcessingTimeMs: 0,
            minProcessingTimeMs: 0,
            maxProcessingTimeMs: 0,
            lastProcessedAt: null,
            lastErrorAt: null,
            errorRate: 0,
            batchesProcessed: 0,
            avgBatchSize: 0,
            maxBatchSize: 0
        };
    }

    public getName(): string {
        return this.name;
    }

    public async enqueue(transaction: ITransaction): Promise<void> {
        await this.enqueueBatch([transaction]);
    }

    public async enqueueBatch(transactions: ITransaction[]): Promise<void> {
        if (this.shouldThrowError) {
            throw new Error(`Mock error from ${this.name}`);
        }
        this.enqueuedBatches.push([...transactions]);
        this.mockStats.totalProcessed += transactions.length;
        this.mockStats.batchesProcessed = (this.mockStats.batchesProcessed || 0) + 1;
    }

    public getStats(): IObserverStats {
        return this.mockStats;
    }

    public getEnqueuedBatches(): ITransaction[][] {
        return this.enqueuedBatches;
    }

    public setStats(stats: Partial<IObserverStats>): void {
        this.mockStats = { ...this.mockStats, ...stats };
    }
}

/**
 * Mock block observer implementation for testing.
 */
class MockBlockObserver implements IBaseBlockObserver {
    private enqueuedBlocks: IBlockData[] = [];
    private shouldThrowError = false;
    private mockStats: IObserverStats;

    constructor(
        private name: string,
        throwError = false
    ) {
        this.shouldThrowError = throwError;
        this.mockStats = {
            name: this.name,
            queueDepth: 0,
            totalProcessed: 0,
            totalErrors: 0,
            totalDropped: 0,
            avgProcessingTimeMs: 0,
            minProcessingTimeMs: 0,
            maxProcessingTimeMs: 0,
            lastProcessedAt: null,
            lastErrorAt: null,
            errorRate: 0,
            blocksProcessed: 0,
            avgTransactionsPerBlock: 0,
            maxTransactionsInBlock: 0
        };
    }

    public getName(): string {
        return this.name;
    }

    public async enqueue(_transaction: ITransaction): Promise<void> {
        // Block observers don't process individual transactions
    }

    public async enqueueBlock(blockData: IBlockData): Promise<void> {
        if (this.shouldThrowError) {
            throw new Error(`Mock error from ${this.name}`);
        }
        this.enqueuedBlocks.push({ ...blockData });
        this.mockStats.totalProcessed += 1;
        this.mockStats.blocksProcessed = (this.mockStats.blocksProcessed || 0) + 1;
    }

    public getStats(): IObserverStats {
        return this.mockStats;
    }

    public getEnqueuedBlocks(): IBlockData[] {
        return this.enqueuedBlocks;
    }

    public setStats(stats: Partial<IObserverStats>): void {
        this.mockStats = { ...this.mockStats, ...stats };
    }
}

/**
 * Create a mock block data object for testing.
 */
function createMockBlockData(blockNumber: number, transactionCount: number): IBlockData {
    const transactions = Array.from({ length: transactionCount }, (_, i) =>
        createMockTransaction('TransferContract', `block_${blockNumber}_tx_${i}`)
    );

    return {
        blockNumber,
        blockId: `block_id_${blockNumber}`,
        parentHash: `parent_hash_${blockNumber - 1}`,
        witnessAddress: 'TMockWitnessAddress',
        timestamp: new Date(),
        transactionCount,
        size: 1000 + transactionCount * 100,
        transactions
    };
}
