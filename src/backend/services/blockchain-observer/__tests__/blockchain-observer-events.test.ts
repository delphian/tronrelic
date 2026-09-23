/**
 * Unit tests for event subscriptions on the blockchain observer service.
 *
 * Event observers are how plugins follow token movements, including the ones
 * made inside another contract's call. The tests pin what the plan promised
 * them: only matching events, once each, in chain order, one batch per block,
 * and an explicit empty batch when the block has no receipts so a gap is never
 * mistaken for "nothing moved".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
    IBaseEventObserver,
    IBlockData,
    IContractEvent,
    IContractEventBatch,
    IObserverStats,
    ISystemLogService,
    ITokenTransferEvent,
    ITransaction
} from '@/types';
import { BlockchainObserverService } from '../blockchain-observer.service.js';

const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ISSUE = 'cb8241adb0c3fdb35b70c24ce35c5eb0c17af7431c99f827d44a445ca624176a';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const OTHER_TOKEN = 'TOtherToken';

/**
 * Build a logger whose methods are spies, since the service logs on every
 * subscription and the tests do not assert on it.
 *
 * @returns A logger stub satisfying the service's constructor.
 */
function createLogger(): ISystemLogService {
    const logger = { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as Record<string, unknown>;
    logger.child = vi.fn(() => logger);

    return logger as unknown as ISystemLogService;
}

/**
 * An event observer that records every batch it is handed.
 */
class RecordingEventObserver implements IBaseEventObserver {
    public readonly batches: IContractEventBatch[] = [];

    /**
     * @param name - Name reported to the service, used in its logs.
     */
    constructor(private readonly name: string) {}

    /**
     * Record a batch instead of processing it.
     *
     * @param batch - The block's matching events.
     */
    public async enqueueEvents(batch: IContractEventBatch): Promise<void> {
        this.batches.push(batch);
    }

    /** Not used by event dispatch. */
    public async enqueue(): Promise<void> {}

    /** @returns The observer's name. */
    public getName(): string {
        return this.name;
    }

    /** @returns Zeroed statistics; the tests do not read them. */
    public getStats(): IObserverStats {
        return {
            name: this.name, queueDepth: 0, totalProcessed: 0, totalErrors: 0, totalDropped: 0,
            avgProcessingTimeMs: 0, minProcessingTimeMs: 0, maxProcessingTimeMs: 0,
            lastProcessedAt: null, lastErrorAt: null, errorRate: 0
        };
    }
}

/**
 * Build a normalised event.
 *
 * @param txId - Owning transaction.
 * @param logIndex - Position in the transaction's logs.
 * @param topic0 - Event signature hash.
 * @param contractAddress - Emitting contract.
 * @returns The event.
 */
function event(txId: string, logIndex: number, topic0: string, contractAddress: string): IContractEvent {
    return { eventId: `${txId}:${logIndex}`, txId, logIndex, contractAddress, topics: [topic0], data: '' };
}

/**
 * Build a transaction carrying the given events.
 *
 * @param txId - Transaction id.
 * @param events - Events the transaction emitted.
 * @param tokenTransfers - Decoded transfers for those events.
 * @returns The transaction.
 */
function transaction(txId: string, events: IContractEvent[], tokenTransfers: ITokenTransferEvent[] = []): ITransaction {
    return {
        payload: {
            txId,
            blockNumber: 500,
            timestamp: new Date(0),
            type: 'TriggerSmartContract',
            from: { address: 'TFrom' },
            to: { address: 'TTo' },
            events,
            tokenTransfers
        },
        snapshot: {},
        categories: { isDelegation: false, isStake: false, isTokenCreation: false },
        rawValue: {},
        info: null
    };
}

/**
 * Build a block around transactions.
 *
 * @param transactions - The block's transactions in chain order.
 * @param receiptsFetched - Whether the block's receipts were complete.
 * @returns The block.
 */
function block(transactions: ITransaction[], receiptsFetched = true): IBlockData {
    return {
        blockNumber: 500,
        blockId: 'block-500',
        parentHash: 'block-499',
        witnessAddress: 'TWitness',
        timestamp: new Date(0),
        transactionCount: transactions.length,
        receiptsFetched,
        transactions
    };
}

/**
 * Let fire-and-forget deliveries land.
 *
 * @returns A promise resolving after pending microtasks.
 */
async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('BlockchainObserverService event subscriptions', () => {
    let service: BlockchainObserverService;

    beforeEach(() => {
        BlockchainObserverService.resetForTesting();
        service = BlockchainObserverService.initialize(createLogger());
    });

    afterEach(() => {
        BlockchainObserverService.resetForTesting();
    });

    it('delivers only events matching the signature and contract, with the decoded transfer attached', async () => {
        const observer = new RecordingEventObserver('usdt-transfers');
        service.subscribeEventsBatch({ topic0: TRANSFER, contractAddresses: [USDT] }, observer);

        const usdtTransfer = event('tx-1', 0, TRANSFER, USDT);
        const decoded: ITokenTransferEvent = {
            eventId: 'tx-1:0', txId: 'tx-1', logIndex: 0, source: 'log', standard: 'trc20',
            contractAddress: USDT, from: 'TA', to: 'TB', rawAmount: '1'
        };
        await service.notifyBlockEvents(block([
            transaction('tx-1', [usdtTransfer, event('tx-1', 1, TRANSFER, OTHER_TOKEN), event('tx-1', 2, ISSUE, USDT)], [decoded])
        ]));
        await settle();

        expect(observer.batches).toHaveLength(1);
        expect(observer.batches[0].receiptsFetched).toBe(true);
        expect(observer.batches[0].events.map(observed => observed.event.eventId)).toEqual(['tx-1:0']);
        expect(observer.batches[0].events[0].tokenTransfer).toBe(decoded);
    });

    it('merges several filters into one batch per block, once per event, in chain order', async () => {
        const observer = new RecordingEventObserver('usdt-supply');
        service.subscribeEventsBatch({ topic0: ISSUE }, observer);
        service.subscribeEventsBatch({ topic0: [`0x${TRANSFER.toUpperCase()}`, ISSUE], contractAddresses: [USDT] }, observer);

        await service.notifyBlockEvents(block([
            transaction('tx-1', [event('tx-1', 0, TRANSFER, USDT)]),
            transaction('tx-2', [event('tx-2', 0, ISSUE, USDT), event('tx-2', 1, TRANSFER, USDT)])
        ]));
        await settle();

        expect(observer.batches).toHaveLength(1);
        expect(observer.batches[0].events.map(observed => observed.event.eventId)).toEqual(['tx-1:0', 'tx-2:0', 'tx-2:1']);
    });

    it('sends nothing for a complete block with no matches', async () => {
        const observer = new RecordingEventObserver('usdt-transfers');
        service.subscribeEventsBatch({ topic0: TRANSFER, contractAddresses: [USDT] }, observer);

        await service.notifyBlockEvents(block([transaction('tx-1', [event('tx-1', 0, TRANSFER, OTHER_TOKEN)])]));
        await settle();

        expect(observer.batches).toEqual([]);
    });

    it('sends an empty batch flagged as a gap when the block has no receipts', async () => {
        const observer = new RecordingEventObserver('usdt-transfers');
        service.subscribeEventsBatch({ topic0: TRANSFER }, observer);

        await service.notifyBlockEvents(block([transaction('tx-1', [])], false));
        await settle();

        expect(observer.batches).toEqual([{
            blockNumber: 500,
            blockTimestamp: new Date(0),
            receiptsFetched: false,
            events: []
        }]);
    });

    it('rejects a filter whose signature is not a 32-byte hash', () => {
        const observer = new RecordingEventObserver('broken');

        expect(() => service.subscribeEventsBatch({ topic0: 'ddf252ad' }, observer)).toThrow(/invalid event filter/);
        expect(() => service.subscribeEventsBatch({ topic0: [] }, observer)).toThrow(/invalid event filter/);
    });

    it('reports subscriptions, includes event observers in stats, and removes them on teardown', async () => {
        const observer = new RecordingEventObserver('usdt-transfers');
        service.subscribeEventsBatch({ topic0: TRANSFER }, observer);
        service.subscribeEventsBatch({ topic0: TRANSFER, contractAddresses: [USDT] }, observer);

        expect(service.getEventSubscriptionStats()).toEqual({ [TRANSFER]: 1 });
        expect(service.getAllObserverStats()).toContainEqual(expect.objectContaining({
            name: 'usdt-transfers',
            kind: 'event',
            subscriptions: ['ddf252ad… (any contract)', 'ddf252ad… (1 contract)']
        }));

        expect(service.unsubscribeObserver(observer)).toBe(1);
        await service.notifyBlockEvents(block([transaction('tx-1', [event('tx-1', 0, TRANSFER, USDT)])]));
        await settle();

        expect(observer.batches).toEqual([]);
        expect(service.getEventSubscriptionStats()).toEqual({});
    });
});
