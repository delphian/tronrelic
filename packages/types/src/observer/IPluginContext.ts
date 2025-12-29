import type { AxiosInstance } from 'axios';
import type { IBlockchainObserverService } from './IBlockchainObserverService.js';
import type { IWebSocketService } from './IWebSocketService.js';
import type { IBaseObserver } from './IBaseObserver.js';
import type { IBaseBatchObserver } from './IBaseBatchObserver.js';
import type { IBaseBlockObserver } from './IBaseBlockObserver.js';
import type { IDatabaseService } from '../database/IDatabaseService.js';
import type { IClickHouseService } from '../clickhouse/IClickHouseService.js';
import type { IPluginWebSocketManager } from './IPluginWebSocketManager.js';
import type { ICacheService } from '../services/ICacheService.js';
import type { ISystemConfigService } from '../system-config/ISystemConfigService.js';
import type { IMenuService } from '../menu/IMenuService.js';
import type { ISchedulerService } from '../scheduler/ISchedulerService.js';
import type { IChainParametersService } from '../chain-parameters/IChainParametersService.js';
import type { IUsdtParametersService } from '../usdt-parameters/IUsdtParametersService.js';
import type { IWidgetService } from '../widget/IWidgetService.js';
import type { ITronGridService } from '../tron-grid/ITronGridService.js';
import type { IBlockchainService } from '../blockchain/IBlockchainService.js';
import type { IAddressLabelService } from '../address-label/IAddressLabelService.js';
import type { IUserService } from '../user/IUserService.js';
import { ISystemLogService } from '../system-log/ISystemLogService.js';

/**
 * Plugin context provided to backend plugins during initialization.
 *
 * Contains infrastructure services that plugins receive via dependency injection.
 * This context allows plugins to interact with core backend services without
 * importing concrete implementations, preventing circular dependencies.
 * The injected logger keeps structured telemetry consistent across plugins.
 */
export interface IPluginContext {
    /** HTTP client (Axios) for making REST API calls to external services */
    http: AxiosInstance;
    /** Blockchain observer service for subscribing to blockchain transaction types */
    observerRegistry: IBlockchainObserverService;

    /** WebSocket service for emitting real-time events to frontend clients (legacy, prefer websocket) */
    websocketService: IWebSocketService;

    /** Plugin-scoped WebSocket manager for custom subscriptions, rooms, and namespaced events */
    websocket: IPluginWebSocketManager;

    /**
     * Base observer class constructor for plugins to extend.
     *
     * Receives a scoped logger so each observer instance emits structured logs
     * with plugin metadata baked in.
     */
    BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver;

    /**
     * Base batch observer class constructor for plugins to extend.
     *
     * Batch observers receive all transactions of a subscribed type from a block at once,
     * enabling efficient bulk processing patterns such as batch database inserts.
     */
    BaseBatchObserver: abstract new (logger: ISystemLogService) => IBaseBatchObserver;

    /**
     * Base block observer class constructor for plugins to extend.
     *
     * Block observers receive entire blocks with all their transactions after processing
     * completes, enabling cross-transaction analysis and block-level metrics calculation.
     */
    BaseBlockObserver: abstract new (logger: ISystemLogService) => IBaseBlockObserver;

    /** Plugin-scoped database access with automatic collection prefixing */
    database: IDatabaseService;

    /**
     * ClickHouse analytical database service.
     *
     * Optional - only available if CLICKHOUSE_HOST is configured. Use for
     * time-series data, high-volume analytics, and aggregation workloads
     * that benefit from columnar storage.
     *
     * Check for undefined before using:
     * ```typescript
     * if (context.clickhouse) {
     *     const results = await context.clickhouse.query('SELECT ...');
     * }
     * ```
     */
    clickhouse?: IClickHouseService;

    /** Cache service for Redis-backed key-value storage with TTL and tagging */
    cache: ICacheService;

    /** System configuration service for accessing runtime-editable settings like site URL */
    systemConfig: ISystemConfigService;

    /** Menu service for registering navigation menu items */
    menuService: IMenuService;

    /** Scheduler service for registering cron jobs that run on schedules */
    scheduler: ISchedulerService;

    /** Chain parameters service for accessing TRON network parameters and energy/TRX conversions */
    chainParameters: IChainParametersService;

    /** USDT parameters service for accessing dynamic USDT transfer energy costs */
    usdtParameters: IUsdtParametersService;

    /** Widget service for registering UI widgets that inject into page zones */
    widgetService: IWidgetService;

    /** TronGrid service for querying TRON blockchain data with rate limiting and key rotation */
    tronGrid: ITronGridService;

    /** Blockchain service for accessing sync state and processed block data */
    blockchainService: IBlockchainService;

    /** Address label service for looking up and contributing blockchain address labels */
    addressLabelService: IAddressLabelService;

    /** User service for accessing user identity and wallet verification status */
    userService: IUserService;

    /** Structured logger scoped to the plugin for consistent telemetry */
    logger: ISystemLogService;
}
