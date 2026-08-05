/**
 * @fileoverview Per-plugin blockchain observer facade.
 *
 * Each plugin receives an `IBlockchainObserverService` instance wrapping the shared
 * `BlockchainObserverService`. The facade records every subscription the plugin
 * makes so the plugin loader can revoke all of them on `disable()` without each
 * plugin tracking its own observers by hand.
 *
 * Why this exists: observer subscriptions used to be permanent. Plugins are
 * toggleable at runtime, so a disabled plugin's observer kept receiving every
 * matching transaction — still writing to its collections, still emitting
 * WebSocket events — until the process restarted, while the admin observer table
 * went on listing it as live. Scoping registrations per plugin is what makes
 * "disabled" actually mean stopped.
 *
 * @module backend/observers/plugin-observer-registry
 */

import type {
    IBaseBatchObserver,
    IBaseBlockObserver,
    IBaseObserver,
    IBlockData,
    IBlockchainObserverService,
    IObserverStats,
    ISystemLogService,
    ITransaction
} from '@/types';

/**
 * One tracked subscription, retained so it can be revoked on teardown.
 *
 * `transactionType` is present only for per-type subscriptions; batch and block
 * registrations cover the observer as a whole and carry no per-type handle.
 */
interface ITrackedSubscription {
    kind: 'transaction-type' | 'batch' | 'block';
    observer: IBaseObserver | IBaseBatchObserver | IBaseBlockObserver;
    transactionType?: string;
}

/**
 * Per-plugin facade over the shared blockchain observer service.
 *
 * Delegates every call to the underlying service while recording subscriptions
 * so `closeAndDisposeAll()` can revoke them. Implements the same
 * `IBlockchainObserverService` contract plugins already consume, so plugin code
 * needs no change to benefit.
 */
export class PluginObserverRegistry implements IBlockchainObserverService {
    /** Every subscription made through this facade, in registration order. */
    private readonly subscriptions: ITrackedSubscription[] = [];

    /** Whether new subscriptions are still accepted. */
    private open: boolean = true;

    /**
     * Construct a facade scoped to one plugin.
     *
     * @param pluginId - Owning plugin id, used for diagnostics when a teardown misbehaves.
     * @param service - Shared process-wide observer service that does the real routing.
     * @param logger - Plugin-scoped logger.
     */
    constructor(
        private readonly pluginId: string,
        private readonly service: IBlockchainObserverService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Subscribe an observer to a transaction type and record it for teardown.
     *
     * @param transactionType - The transaction type to observe.
     * @param observer - The observer to notify when matching transactions arrive.
     */
    public subscribeTransactionType(transactionType: string, observer: IBaseObserver): void {
        this.assertOpen(`subscribeTransactionType('${transactionType}')`);
        this.service.subscribeTransactionType(transactionType, observer);
        this.subscriptions.push({ kind: 'transaction-type', observer, transactionType });
    }

    /**
     * Subscribe a batch observer to a set of transaction types and record it for teardown.
     *
     * @param transactionTypes - Transaction types the observer wants batched per block.
     * @param observer - The batch observer to notify.
     */
    public subscribeTransactionTypesBatch(transactionTypes: string[], observer: IBaseBatchObserver): void {
        this.assertOpen('subscribeTransactionTypesBatch');
        this.service.subscribeTransactionTypesBatch(transactionTypes, observer);
        this.subscriptions.push({ kind: 'batch', observer });
    }

    /**
     * Subscribe a block observer and record it for teardown.
     *
     * @param observer - The block observer to notify once per completed block.
     */
    public subscribeBlock(observer: IBaseBlockObserver): void {
        this.assertOpen('subscribeBlock');
        this.service.subscribeBlock(observer);
        this.subscriptions.push({ kind: 'block', observer });
    }

    /**
     * Revoke every subscription this plugin made and stop the observers behind them.
     *
     * Called by the plugin manager on `disable()` and `uninstall()`. Unsubscribing alone would
     * leave already-queued work draining, so each observer is also stopped — that is what makes
     * a disabled plugin stop writing immediately rather than eventually. Each revocation is
     * isolated: one throwing observer cannot strand the rest still subscribed.
     *
     * @returns Count of subscriptions revoked, for the caller's teardown log.
     */
    public closeAndDisposeAll(): number {
        this.open = false;

        const snapshot = this.subscriptions.splice(0, this.subscriptions.length);
        const stopped = new Set<IBaseObserver | IBaseBatchObserver | IBaseBlockObserver>();

        for (const subscription of snapshot) {
            try {
                this.revoke(subscription);

                // An observer can hold more than one subscription; stop it once.
                if (!stopped.has(subscription.observer)) {
                    stopped.add(subscription.observer);
                    subscription.observer.stop?.();
                }
            } catch (err) {
                this.logger.warn(
                    { err, pluginId: this.pluginId, kind: subscription.kind },
                    'Observer disposer threw during plugin disable'
                );
            }
        }

        return snapshot.length;
    }

    /**
     * Reopen the facade so a re-enabled plugin can subscribe again.
     *
     * `enablePlugin` re-runs the plugin's init hook, which constructs fresh observers and
     * subscribes them. Without rearming, those calls would throw against a facade closed by the
     * previous disable — mirroring how the hook facade is rearmed on the same path.
     */
    public rearm(): void {
        this.open = true;
    }

    // =========================================================================
    // Pass-through members — the facade scopes registration, not routing.
    // =========================================================================

    /**
     * Unsubscribe an observer from a transaction type.
     *
     * @param transactionType - The transaction type to stop observing.
     * @param observer - The observer to remove.
     * @returns True when the observer was subscribed and has been removed.
     */
    public unsubscribeTransactionType(transactionType: string, observer: IBaseObserver): boolean {
        this.forget(sub => sub.kind === 'transaction-type' && sub.observer === observer && sub.transactionType === transactionType);

        return this.service.unsubscribeTransactionType(transactionType, observer);
    }

    /**
     * Unsubscribe a batch observer from all of its transaction types.
     *
     * @param observer - The batch observer to remove.
     * @returns True when the observer was subscribed and has been removed.
     */
    public unsubscribeTransactionTypesBatch(observer: IBaseBatchObserver): boolean {
        this.forget(sub => sub.kind === 'batch' && sub.observer === observer);

        return this.service.unsubscribeTransactionTypesBatch(observer);
    }

    /**
     * Unsubscribe a block observer.
     *
     * @param observer - The block observer to remove.
     * @returns True when the observer was subscribed and has been removed.
     */
    public unsubscribeBlock(observer: IBaseBlockObserver): boolean {
        this.forget(sub => sub.kind === 'block' && sub.observer === observer);

        return this.service.unsubscribeBlock(observer);
    }

    /**
     * Remove an observer from every subscription it holds.
     *
     * @param observer - The observer to remove from all subscriber collections.
     * @returns Count of subscriptions removed.
     */
    public unsubscribeObserver(observer: IBaseObserver | IBaseBatchObserver | IBaseBlockObserver): number {
        this.forget(sub => sub.observer === observer);

        return this.service.unsubscribeObserver(observer);
    }

    /**
     * Broadcast a transaction to its subscribers.
     *
     * @param transaction - The enriched transaction to route.
     */
    public async notifyTransaction(transaction: ITransaction): Promise<void> {
        return this.service.notifyTransaction(transaction);
    }

    /**
     * Accumulate a transaction for the current block's batch flush.
     *
     * @param transaction - The enriched transaction to accumulate.
     */
    public accumulateForBatch(transaction: ITransaction): void {
        this.service.accumulateForBatch(transaction);
    }

    /** Clear the batch accumulator ahead of a new block. */
    public clearBatchAccumulator(): void {
        this.service.clearBatchAccumulator();
    }

    /** Deliver accumulated batches to batch subscribers. */
    public async flushBatches(): Promise<void> {
        return this.service.flushBatches();
    }

    /**
     * Broadcast a completed block to block subscribers.
     *
     * @param blockData - Block metadata and its enriched transactions.
     */
    public async notifyBlock(blockData: IBlockData): Promise<void> {
        return this.service.notifyBlock(blockData);
    }

    /** @returns Per-type subscriber counts across the whole process. */
    public getSubscriptionStats(): Record<string, number> {
        return this.service.getSubscriptionStats();
    }

    /** @returns Per-type batch subscriber counts across the whole process. */
    public getBatchSubscriptionStats(): Record<string, number> {
        return this.service.getBatchSubscriptionStats();
    }

    /** @returns Block subscriber count across the whole process. */
    public getBlockSubscriptionStats(): { subscriberCount: number } {
        return this.service.getBlockSubscriptionStats();
    }

    /** @returns Statistics for every observer registered process-wide. */
    public getAllObserverStats(): IObserverStats[] {
        return this.service.getAllObserverStats();
    }

    /** @returns System-wide aggregate observer statistics. */
    public getAggregateStats(): {
        totalObservers: number;
        totalProcessed: number;
        totalErrors: number;
        totalDropped: number;
        totalQueueDepth: number;
        avgProcessingTimeMs: number;
        highestErrorRate: number;
        observersWithErrors: number;
    } {
        return this.service.getAggregateStats();
    }

    /**
     * Drop tracked subscriptions matching a predicate.
     *
     * Keeps the facade's ledger honest when a plugin revokes something itself, so a later
     * teardown does not try to revoke it a second time.
     *
     * @param predicate - Returns true for entries that should stop being tracked.
     */
    private forget(predicate: (subscription: ITrackedSubscription) => boolean): void {
        for (let index = this.subscriptions.length - 1; index >= 0; index -= 1) {
            if (predicate(this.subscriptions[index])) {
                this.subscriptions.splice(index, 1);
            }
        }
    }

    /**
     * Revoke one tracked subscription against the shared service.
     *
     * @param subscription - The tracked entry to revoke.
     */
    private revoke(subscription: ITrackedSubscription): void {
        if (subscription.kind === 'transaction-type' && subscription.transactionType) {
            this.service.unsubscribeTransactionType(subscription.transactionType, subscription.observer as IBaseObserver);

            return;
        }

        if (subscription.kind === 'batch') {
            this.service.unsubscribeTransactionTypesBatch(subscription.observer as IBaseBatchObserver);

            return;
        }

        this.service.unsubscribeBlock(subscription.observer as IBaseBlockObserver);
    }

    /**
     * Reject subscriptions attempted after the plugin's lifecycle window closed.
     *
     * A subscription made after disable would be untracked and therefore unrevocable — exactly
     * the leak this facade exists to prevent — so it fails loudly instead of silently escaping
     * teardown.
     *
     * @param operation - Human-readable call description used in the error message.
     */
    private assertOpen(operation: string): void {
        if (!this.open) {
            throw new Error(
                `Plugin '${this.pluginId}' attempted ${operation} after its lifecycle window closed. ` +
                `Observer subscription is permitted only during install/enable/init — subscribe at startup, ` +
                `not from request handlers or scheduled jobs.`
            );
        }
    }
}
