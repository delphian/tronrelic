/**
 * @file variables/types.ts
 *
 * Dependency surface the built-in dynamic prompt-variable resolvers close over.
 *
 * Core registers the built-in variables so they exist for whichever AI provider is
 * installed (or none), rather than coupling "what variables exist" to whether a
 * provider plugin is enabled. The resolvers' core singletons are declared here as
 * interfaces so the module injects them rather than importing concrete classes.
 */

import type {
    IBlockchainService,
    IBlockchainObserverService,
    ICacheService,
    IChainParametersService,
    IMenuService,
    ISystemConfigService,
    ISystemLogService,
    IUsdtParametersService
} from '@/types';

/**
 * Core services the built-in variable resolvers read at expansion time. Captured
 * once at module init; each resolver calls into them lazily when a prompt that
 * references its `{%name%}` is expanded, long after bootstrap.
 */
export interface IBuiltinVariableDeps {
    /** Block sync reads: latest block, transaction timeseries, per-type counts. */
    blockchainService: IBlockchainService;
    /** TRON chain parameters: energy fee, conversions, network limits. */
    chainParameters: IChainParametersService;
    /** USDT transfer energy costs (standard / first-time). */
    usdtParameters: IUsdtParametersService;
    /** Observer processing stats: throughput, errors, queue depth, subscriptions. */
    observerRegistry: IBlockchainObserverService;
    /** System log statistics for the log-summary variable. */
    systemLog: ISystemLogService;
    /** Runtime site URL for the site-info variable. */
    systemConfig: ISystemConfigService;
    /** Menu trees and namespaces for the site-info variable. */
    menuService: IMenuService;
    /** Redis key enumeration for the cache-keys variable. */
    cache: ICacheService;
}
