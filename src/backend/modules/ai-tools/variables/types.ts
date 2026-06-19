/**
 * @file variables/types.ts
 *
 * Dependency surface the built-in dynamic prompt-variable resolvers close over.
 *
 * These resolvers were lifted out of the trp-ai-assistant plugin so the core
 * ai-tools module owns every built-in variable: the plugin used to register them
 * into the core `'prompt-variables'` registry through `IPluginContext`, which
 * coupled "what variables exist" to whether the Anthropic provider happened to be
 * enabled. Core registers them now, so the variables exist for whichever AI
 * provider is installed (or none). The resolvers reference the same core
 * singletons the plugin context exposed — declared here as interfaces so the
 * module injects them rather than importing concrete classes.
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
