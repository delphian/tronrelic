/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService, ITransaction, IBlockData, IObserverStats } from '@tronrelic/types';
import { BaseBlockObserver } from '../BaseBlockObserver.js';

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
 * Concrete implementation of BaseBlockObserver for testing.
 *
 * Tracks processed blocks and allows configurable behavior for testing
 * error handling and statistics.
 */
class TestBlockObserver extends BaseBlockObserver {
    protected readonly name = 'TestBlockObserver';
    public processedBlocks: IBlockData[] = [];
    private shouldThrowError = false;
    private processingDelayMs = 0;

    public setThrowError(shouldThrow: boolean): void {
        this.shouldThrowError = shouldThrow;
    }

    public setProcessingDelay(delayMs: number): void {
        this.processingDelayMs = delayMs;
    }

    protected async processBlock(blockData: IBlockData): Promise<void> {
        if (this.processingDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.processingDelayMs));
        }

        if (this.shouldThrowError) {
            throw new Error('Test error from block processing');
        }

        this.processedBlocks.push({ ...blockData });
    }

    public clearProcessed(): void {
        this.processedBlocks = [];
    }
}

/**
 * Create a mock transaction for testing.
 *
 * @param type - Transaction type (e.g., 'TransferContract')
 * @param txId - Optional transaction ID
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
 * Create a mock block data object for testing.
 *
 * @param blockNumber - Block number
 * @param transactionCount - Number of transactions to include
 * @returns Mock block data
 */
function createMockBlockData(blockNumber: number, transactionCount: number = 10): IBlockData {
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

describe('BaseBlockObserver', () => {
    let observer: TestBlockObserver;
    let mockLogger: MockLogger;

    beforeEach(() => {
        mockLogger = new MockLogger();
        observer = new TestBlockObserver(mockLogger);
    });

    describe('Constructor and Basic Properties', () => {
        it('should initialize with correct name', () => {
            expect(observer.getName()).toBe('TestBlockObserver');
        });

        it('should initialize with empty queue and zero stats', () => {
            const stats = observer.getStats();

            expect(stats.name).toBe('TestBlockObserver');
            expect(stats.queueDepth).toBe(0);
            expect(stats.totalProcessed).toBe(0);
            expect(stats.totalErrors).toBe(0);
            expect(stats.totalDropped).toBe(0);
            expect(stats.blocksProcessed).toBe(0);
            expect(stats.avgTransactionsPerBlock).toBe(0);
            expect(stats.maxTransactionsInBlock).toBe(0);
        });
    });

    describe('Block Enqueueing', () => {
        it('should enqueue and process a block', async () => {
            const blockData = createMockBlockData(12345, 5);

            await observer.enqueueBlock(blockData);

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(observer.processedBlocks).toHaveLength(1);
            expect(observer.processedBlocks[0].blockNumber).toBe(12345);
            expect(observer.processedBlocks[0].transactions).toHaveLength(5);
        });

        it('should process multiple blocks serially', async () => {
            const block1 = createMockBlockData(100, 3);
            const block2 = createMockBlockData(101, 5);
            const block3 = createMockBlockData(102, 2);

            await observer.enqueueBlock(block1);
            await observer.enqueueBlock(block2);
            await observer.enqueueBlock(block3);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(observer.processedBlocks).toHaveLength(3);
            expect(observer.processedBlocks[0].blockNumber).toBe(100);
            expect(observer.processedBlocks[1].blockNumber).toBe(101);
            expect(observer.processedBlocks[2].blockNumber).toBe(102);
        });

        it('should skip already processing blocks', async () => {
            observer.setProcessingDelay(100);
            const block1 = createMockBlockData(100, 2);
            const block2 = createMockBlockData(101, 2);

            // Start first block processing
            await observer.enqueueBlock(block1);
            // Queue second block while first is processing
            await observer.enqueueBlock(block2);

            // Wait for all processing to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            expect(observer.processedBlocks).toHaveLength(2);
        });
    });

    describe('Single Transaction Enqueue (IBaseObserver compatibility)', () => {
        it('should warn when enqueue() is called (wrong method for block observers)', async () => {
            const transaction = createMockTransaction('TransferContract');

            await observer.enqueue(transaction);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ observer: 'TestBlockObserver' }),
                'Block observer received individual transaction via enqueue() - use enqueueBlock() instead'
            );
        });
    });

    describe('Statistics Tracking', () => {
        it('should track total blocks processed', async () => {
            await observer.enqueueBlock(createMockBlockData(100, 5));
            await observer.enqueueBlock(createMockBlockData(101, 3));
            await observer.enqueueBlock(createMockBlockData(102, 7));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.totalProcessed).toBe(3); // 3 blocks
            expect(stats.blocksProcessed).toBe(3);
        });

        it('should calculate average transactions per block', async () => {
            await observer.enqueueBlock(createMockBlockData(100, 2)); // 2
            await observer.enqueueBlock(createMockBlockData(101, 4)); // 4
            await observer.enqueueBlock(createMockBlockData(102, 6)); // 6

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.avgTransactionsPerBlock).toBe(4); // (2 + 4 + 6) / 3 = 4
        });

        it('should track max transactions in block', async () => {
            await observer.enqueueBlock(createMockBlockData(100, 3));
            await observer.enqueueBlock(createMockBlockData(101, 15));
            await observer.enqueueBlock(createMockBlockData(102, 5));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.maxTransactionsInBlock).toBe(15);
        });

        it('should track processing time', async () => {
            observer.setProcessingDelay(20);

            await observer.enqueueBlock(createMockBlockData(100, 5));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            // Use 15ms threshold to allow for timer jitter on CI runners
            expect(stats.avgProcessingTimeMs).toBeGreaterThanOrEqual(15);
            expect(stats.minProcessingTimeMs).toBeGreaterThanOrEqual(15);
            expect(stats.maxProcessingTimeMs).toBeGreaterThanOrEqual(15);
        });

        it('should update lastProcessedAt timestamp', async () => {
            const beforeProcess = new Date();

            await observer.enqueueBlock(createMockBlockData(100, 1));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats = observer.getStats();
            expect(stats.lastProcessedAt).not.toBeNull();

            const processedAt = new Date(stats.lastProcessedAt!);
            expect(processedAt.getTime()).toBeGreaterThanOrEqual(beforeProcess.getTime());
        });
    });

    describe('Error Handling', () => {
        it('should log error and continue processing on block failure', async () => {
            observer.setThrowError(true);

            const blockData = createMockBlockData(100, 5);
            await observer.enqueueBlock(blockData);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    observer: 'TestBlockObserver',
                    blockNumber: 100,
                    transactionCount: 5
                }),
                'Block observer failed to process block - continuing with next block'
            );
        });

        it('should track error count', async () => {
            observer.setThrowError(true);

            await observer.enqueueBlock(createMockBlockData(100, 2));
            await observer.enqueueBlock(createMockBlockData(101, 3));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = observer.getStats();
            expect(stats.totalErrors).toBe(2);
        });

        it('should update lastErrorAt timestamp on error', async () => {
            observer.setThrowError(true);

            await observer.enqueueBlock(createMockBlockData(100, 1));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats = observer.getStats();
            expect(stats.lastErrorAt).not.toBeNull();
        });

        it('should calculate error rate correctly', async () => {
            // Process one block successfully
            await observer.enqueueBlock(createMockBlockData(100, 2));
            await new Promise(resolve => setTimeout(resolve, 50));

            // Then fail one block
            observer.setThrowError(true);
            await observer.enqueueBlock(createMockBlockData(101, 2));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats = observer.getStats();
            expect(stats.errorRate).toBe(0.5); // 1 error / 2 total blocks
        });

        it('should continue processing subsequent blocks after error', async () => {
            // First block will succeed
            await observer.enqueueBlock(createMockBlockData(100, 2));

            // Enable error for second block
            observer.setThrowError(true);
            await observer.enqueueBlock(createMockBlockData(101, 2));

            // Disable error for third block
            observer.setThrowError(false);
            await observer.enqueueBlock(createMockBlockData(102, 2));

            await new Promise(resolve => setTimeout(resolve, 150));

            // First and third blocks should be processed
            expect(observer.processedBlocks).toHaveLength(2);
            expect(observer.processedBlocks[0].blockNumber).toBe(100);
            expect(observer.processedBlocks[1].blockNumber).toBe(102);
            expect(observer.getStats().totalErrors).toBe(1);
        });
    });

    describe('Queue Overflow Protection', () => {
        it('should drop incoming block and log error when queue is at MAX_QUEUE_SIZE', async () => {
            // Set processing delay to allow queue to fill
            observer.setProcessingDelay(5000);

            // Enqueue first block to start slow processing
            await observer.enqueueBlock(createMockBlockData(100, 1));

            // Fill queue to max (50 blocks)
            for (let i = 0; i < 50; i++) {
                await observer.enqueueBlock(createMockBlockData(101 + i, 1));
            }

            // This block should be dropped (queue is now at 50)
            await observer.enqueueBlock(createMockBlockData(200, 7));

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    observer: 'TestBlockObserver',
                    droppedBlocks: 1,
                    droppedTransactions: 7
                }),
                'Block observer queue overflow - dropping incoming block to prevent memory issues'
            );
        });

        it('should track dropped transactions count on overflow', async () => {
            observer.setProcessingDelay(5000);

            // Start processing
            await observer.enqueueBlock(createMockBlockData(100, 5));

            // Fill queue to max (50 blocks)
            for (let i = 0; i < 50; i++) {
                await observer.enqueueBlock(createMockBlockData(101 + i, 1));
            }

            // This block of 10 transactions should be dropped
            await observer.enqueueBlock(createMockBlockData(200, 10));

            const stats = observer.getStats();
            expect(stats.totalDropped).toBe(10);
        });

        it('should preserve existing queue when dropping incoming block', async () => {
            observer.setProcessingDelay(5000);

            // Start processing first block
            await observer.enqueueBlock(createMockBlockData(100, 1));

            // Fill queue to max
            for (let i = 0; i < 50; i++) {
                await observer.enqueueBlock(createMockBlockData(101 + i, 1));
            }

            // Queue depth should still be 50 (not cleared)
            const stats = observer.getStats();
            expect(stats.queueDepth).toBe(50);
        });
    });

    describe('Concurrent Operations', () => {
        it('should handle rapid block enqueueing', async () => {
            const blockPromises = Array.from({ length: 20 }, (_, i) =>
                observer.enqueueBlock(createMockBlockData(100 + i, 5))
            );

            await Promise.all(blockPromises);
            await new Promise(resolve => setTimeout(resolve, 200));

            expect(observer.processedBlocks.length).toBe(20);
            expect(observer.getStats().blocksProcessed).toBe(20);
        });

        it('should maintain queue depth accuracy under concurrent operations', async () => {
            observer.setProcessingDelay(10);

            // Enqueue several blocks
            for (let i = 0; i < 5; i++) {
                await observer.enqueueBlock(createMockBlockData(100 + i, 3));
            }

            // Wait for all to complete
            await new Promise(resolve => setTimeout(resolve, 200));

            const stats = observer.getStats();
            expect(stats.queueDepth).toBe(0);
            expect(stats.blocksProcessed).toBe(5);
        });
    });

    describe('Block Data Integrity', () => {
        it('should preserve all block data fields during processing', async () => {
            const originalBlock = createMockBlockData(12345, 3);
            originalBlock.size = 9999;

            await observer.enqueueBlock(originalBlock);
            await new Promise(resolve => setTimeout(resolve, 50));

            const processedBlock = observer.processedBlocks[0];

            expect(processedBlock.blockNumber).toBe(12345);
            expect(processedBlock.blockId).toBe('block_id_12345');
            expect(processedBlock.parentHash).toBe('parent_hash_12344');
            expect(processedBlock.witnessAddress).toBe('TMockWitnessAddress');
            expect(processedBlock.transactionCount).toBe(3);
            expect(processedBlock.size).toBe(9999);
            expect(processedBlock.transactions).toHaveLength(3);
        });

        it('should preserve transaction data within blocks', async () => {
            const blockData = createMockBlockData(100, 2);
            blockData.transactions[0].payload.txId = 'specific_tx_id';
            blockData.transactions[0].payload.type = 'TransferContract';

            await observer.enqueueBlock(blockData);
            await new Promise(resolve => setTimeout(resolve, 50));

            const processedBlock = observer.processedBlocks[0];
            expect(processedBlock.transactions[0].payload.txId).toBe('specific_tx_id');
            expect(processedBlock.transactions[0].payload.type).toBe('TransferContract');
        });
    });

    describe('Stats Return Structure', () => {
        it('should return all required IObserverStats fields', async () => {
            await observer.enqueueBlock(createMockBlockData(100, 5));
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

            // Block-specific fields
            expect(stats).toHaveProperty('blocksProcessed');
            expect(stats).toHaveProperty('avgTransactionsPerBlock');
            expect(stats).toHaveProperty('maxTransactionsInBlock');
        });

        it('should return correct types for stats fields', async () => {
            await observer.enqueueBlock(createMockBlockData(100, 3));
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats = observer.getStats();

            expect(typeof stats.name).toBe('string');
            expect(typeof stats.queueDepth).toBe('number');
            expect(typeof stats.totalProcessed).toBe('number');
            expect(typeof stats.blocksProcessed).toBe('number');
            expect(typeof stats.avgTransactionsPerBlock).toBe('number');
            expect(typeof stats.maxTransactionsInBlock).toBe('number');
        });
    });
});
