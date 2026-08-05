/// <reference types="vitest" />

/**
 * @fileoverview Tests for the per-plugin observer facade.
 *
 * These cover the regression the facade exists to prevent: a plugin disabled from
 * the admin UI used to leave its observers subscribed, so they kept consuming
 * transactions and writing to their collections for the life of the process while
 * still appearing in the admin observer performance table.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
    IBaseBatchObserver,
    IBaseBlockObserver,
    IBaseObserver,
    IBlockData,
    IObserverStats,
    ISystemLogService,
    ITransaction,
    TransactionBatches
} from '@/types';
import { BlockchainObserverService } from '../../services/blockchain-observer/blockchain-observer.service.js';
import { PluginObserverRegistry } from '../plugin-observer-registry.js';

/**
 * Minimal ISystemLogService stub.
 *
 * The facade logs on teardown failures, so tests need a logger that records calls
 * without requiring the real logging stack.
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
}

/**
 * Build the statistics shape observers report, so mocks satisfy IObserverStats.
 *
 * @param name - Observer name carried into the stats object.
 * @returns A zeroed statistics record.
 */
function emptyStats(name: string): IObserverStats {
    return {
        name,
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

/**
 * Per-transaction observer stub that records deliveries and its stop() calls.
 */
class MockObserver implements IBaseObserver {
    public received: ITransaction[] = [];
    public stop = vi.fn();

    constructor(private readonly name: string) {}

    public getName(): string {
        return this.name;
    }

    public async enqueue(transaction: ITransaction): Promise<void> {
        this.received.push(transaction);
    }

    public getStats(): IObserverStats {
        return emptyStats(this.name);
    }
}

/**
 * Batch observer stub — the shape the dust-tracker plugin actually registers.
 */
class MockBatchObserver implements IBaseBatchObserver {
    public received: TransactionBatches[] = [];
    public stop = vi.fn();

    constructor(private readonly name: string) {}

    public getName(): string {
        return this.name;
    }

    public async enqueue(_transaction: ITransaction): Promise<void> {}

    public async enqueueBatch(batches: TransactionBatches): Promise<void> {
        this.received.push(batches);
    }

    public getStats(): IObserverStats {
        return emptyStats(this.name);
    }
}

/**
 * Block observer stub.
 */
class MockBlockObserver implements IBaseBlockObserver {
    public received: IBlockData[] = [];
    public stop = vi.fn();

    constructor(private readonly name: string) {}

    public getName(): string {
        return this.name;
    }

    public async enqueue(_transaction: ITransaction): Promise<void> {}

    public async enqueueBlock(blockData: IBlockData): Promise<void> {
        this.received.push(blockData);
    }

    public getStats(): IObserverStats {
        return emptyStats(this.name);
    }
}

/**
 * Build a minimal transaction of the given contract type.
 *
 * @param type - TRON contract type the routing layer keys on.
 * @returns A transaction sufficient for subscription routing.
 */
function createTransaction(type: string): ITransaction {
    return {
        payload: {
            type,
            txId: `tx_${Math.random().toString(36).slice(2)}`,
            blockNumber: 1,
            timestamp: new Date(),
            from: { address: 'TFrom' },
            to: { address: 'TTo' },
            amount: 1
        },
        snapshot: {},
        categories: { isDelegation: false, isStake: false, isTokenCreation: false },
        rawValue: {},
        info: null
    } as unknown as ITransaction;
}

/**
 * Build minimal block data for block-observer routing.
 *
 * @returns Block data sufficient for notifyBlock.
 */
function createBlock(): IBlockData {
    return {
        blockNumber: 1,
        timestamp: new Date(),
        transactionCount: 0,
        transactions: []
    } as unknown as IBlockData;
}

describe('PluginObserverRegistry', () => {
    let service: BlockchainObserverService;
    let logger: MockLogger;
    let facade: PluginObserverRegistry;

    beforeEach(() => {
        BlockchainObserverService.resetForTesting();
        logger = new MockLogger();
        service = BlockchainObserverService.initialize(logger);
        facade = new PluginObserverRegistry('trp-test', service, logger);
    });

    afterEach(() => {
        BlockchainObserverService.resetForTesting();
    });

    describe('subscription pass-through', () => {
        it('routes transactions to an observer subscribed through the facade', async () => {
            const observer = new MockObserver('per-type');
            facade.subscribeTransactionType('TransferContract', observer);

            await service.notifyTransaction(createTransaction('TransferContract'));

            expect(observer.received).toHaveLength(1);
        });

        it('routes batches to a batch observer subscribed through the facade', async () => {
            const observer = new MockBatchObserver('batch');
            facade.subscribeTransactionTypesBatch(['TransferContract'], observer);

            service.accumulateForBatch(createTransaction('TransferContract'));
            await service.flushBatches();

            expect(observer.received).toHaveLength(1);
        });
    });

    describe('closeAndDisposeAll', () => {
        it('stops delivering transactions after disposal', async () => {
            const observer = new MockObserver('per-type');
            facade.subscribeTransactionType('TransferContract', observer);

            await service.notifyTransaction(createTransaction('TransferContract'));
            facade.closeAndDisposeAll();
            await service.notifyTransaction(createTransaction('TransferContract'));

            expect(observer.received).toHaveLength(1);
        });

        it('stops delivering batches after disposal - the dust-tracker regression', async () => {
            const observer = new MockBatchObserver('dust');
            facade.subscribeTransactionTypesBatch(['TransferContract', 'TriggerSmartContract'], observer);

            service.accumulateForBatch(createTransaction('TransferContract'));
            await service.flushBatches();
            expect(observer.received).toHaveLength(1);

            facade.closeAndDisposeAll();

            service.accumulateForBatch(createTransaction('TransferContract'));
            await service.flushBatches();

            expect(observer.received).toHaveLength(1);
            expect(service.getBatchSubscriptionStats()).toEqual({});
        });

        it('stops delivering blocks after disposal', async () => {
            const observer = new MockBlockObserver('block');
            facade.subscribeBlock(observer);

            await service.notifyBlock(createBlock());
            facade.closeAndDisposeAll();
            await service.notifyBlock(createBlock());

            expect(observer.received).toHaveLength(1);
        });

        it('stops each disposed observer so queued work is discarded', () => {
            const observer = new MockBatchObserver('dust');
            facade.subscribeTransactionTypesBatch(['TransferContract'], observer);

            facade.closeAndDisposeAll();

            expect(observer.stop).toHaveBeenCalledTimes(1);
        });

        it('stops an observer once even when it holds several subscriptions', () => {
            const observer = new MockObserver('multi');
            facade.subscribeTransactionType('TransferContract', observer);
            facade.subscribeTransactionType('TriggerSmartContract', observer);

            const revoked = facade.closeAndDisposeAll();

            expect(revoked).toBe(2);
            expect(observer.stop).toHaveBeenCalledTimes(1);
        });

        it('removes disposed observers from the admin stats table', () => {
            const observer = new MockObserver('admin-table');
            facade.subscribeTransactionType('TransferContract', observer);
            expect(service.getAllObserverStats()).toHaveLength(1);

            facade.closeAndDisposeAll();

            expect(service.getAllObserverStats()).toHaveLength(0);
        });

        it('leaves another plugin\'s subscriptions untouched', async () => {
            const mine = new MockObserver('mine');
            const theirs = new MockObserver('theirs');
            const otherFacade = new PluginObserverRegistry('trp-other', service, logger);

            facade.subscribeTransactionType('TransferContract', mine);
            otherFacade.subscribeTransactionType('TransferContract', theirs);

            facade.closeAndDisposeAll();
            await service.notifyTransaction(createTransaction('TransferContract'));

            expect(mine.received).toHaveLength(0);
            expect(theirs.received).toHaveLength(1);
        });

        it('keeps revoking after one observer throws', () => {
            const throwing = new MockObserver('throwing');
            throwing.stop.mockImplementation(() => {
                throw new Error('stop failed');
            });
            const healthy = new MockObserver('healthy');

            facade.subscribeTransactionType('TransferContract', throwing);
            facade.subscribeTransactionType('TriggerSmartContract', healthy);

            expect(() => facade.closeAndDisposeAll()).not.toThrow();
            expect(healthy.stop).toHaveBeenCalledTimes(1);
            expect(service.getAllObserverStats()).toHaveLength(0);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('is idempotent', () => {
            const observer = new MockObserver('once');
            facade.subscribeTransactionType('TransferContract', observer);

            expect(facade.closeAndDisposeAll()).toBe(1);
            expect(facade.closeAndDisposeAll()).toBe(0);
            expect(observer.stop).toHaveBeenCalledTimes(1);
        });

        it('tolerates an observer that predates stop()', () => {
            const legacy: IBaseObserver = {
                getName: () => 'legacy',
                enqueue: async () => {},
                getStats: () => emptyStats('legacy')
            };
            facade.subscribeTransactionType('TransferContract', legacy);

            expect(() => facade.closeAndDisposeAll()).not.toThrow();
            expect(service.getAllObserverStats()).toHaveLength(0);
        });
    });

    describe('lifecycle window', () => {
        it('rejects subscriptions attempted after disposal', () => {
            facade.closeAndDisposeAll();

            expect(() => facade.subscribeTransactionType('TransferContract', new MockObserver('late')))
                .toThrow(/lifecycle window closed/);
        });

        it('accepts subscriptions again after rearm, as re-enable requires', async () => {
            const first = new MockObserver('first');
            facade.subscribeTransactionType('TransferContract', first);
            facade.closeAndDisposeAll();

            facade.rearm();
            const second = new MockObserver('second');
            facade.subscribeTransactionType('TransferContract', second);

            await service.notifyTransaction(createTransaction('TransferContract'));

            expect(first.received).toHaveLength(0);
            expect(second.received).toHaveLength(1);
        });

        it('does not re-revoke a subscription the plugin already revoked itself', () => {
            const observer = new MockObserver('self-managed');
            facade.subscribeTransactionType('TransferContract', observer);

            expect(facade.unsubscribeTransactionType('TransferContract', observer)).toBe(true);
            expect(facade.closeAndDisposeAll()).toBe(0);
        });

        it('revokes an install-time subscription, which no later teardown would catch', async () => {
            // installPlugin leaves the plugin installed but still disabled, and disablePlugin
            // early-returns on a plugin that is not enabled — so an observer subscribed from an
            // install hook would otherwise run live and survive even uninstall. The manager
            // disposes the facade at the end of install for exactly this reason.
            const installTimeObserver = new MockObserver('install-hook');
            facade.subscribeTransactionType('TransferContract', installTimeObserver);

            facade.closeAndDisposeAll();
            await service.notifyTransaction(createTransaction('TransferContract'));

            expect(installTimeObserver.received).toHaveLength(0);
            expect(installTimeObserver.stop).toHaveBeenCalledTimes(1);

            // The subsequent enable cycle rearms and subscribes for real.
            facade.rearm();
            const initTimeObserver = new MockObserver('init-hook');
            facade.subscribeTransactionType('TransferContract', initTimeObserver);
            await service.notifyTransaction(createTransaction('TransferContract'));

            expect(initTimeObserver.received).toHaveLength(1);
        });
    });
});
