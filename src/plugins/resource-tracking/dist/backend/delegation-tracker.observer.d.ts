import type { IBaseObserver, IBlockchainObserverService, IPluginDatabase, ISystemLogService } from '@/types';
/**
 * Delegation Tracker Observer processes resource delegation and reclaim transactions.
 *
 * This observer subscribes to DelegateResourceContract and UnDelegateResourceContract types,
 * extracts detailed delegation information from the transaction payload, and persists
 * transaction records for aggregation and analysis. The observer tracks both energy
 * and bandwidth delegation flows across the TRON network.
 *
 * Data retention is managed by a separate purge job that runs hourly.
 */
/**
 * Create the delegation tracker observer with injected infrastructure services.
 *
 * The factory receives the base observer implementation, registry, database service,
 * and logger through dependency injection, keeping the plugin portable while integrating
 * with the blockchain transaction pipeline.
 *
 * @param BaseObserver - Base observer class providing queue management and error isolation, needed to extend functionality for delegation tracking
 * @param observerRegistry - Registry for subscribing to specific transaction types, allows this observer to receive delegation events
 * @param database - Plugin-scoped database service for delegation transaction persistence with automatic collection prefixing
 * @param logger - Structured logger scoped to the plugin so delegation logs stay contextualized
 * @returns Instantiated delegation tracker observer ready to process transactions
 */
export declare function createDelegationTrackerObserver(BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver, observerRegistry: IBlockchainObserverService, database: IPluginDatabase, logger: ISystemLogService): IBaseObserver;
//# sourceMappingURL=delegation-tracker.observer.d.ts.map