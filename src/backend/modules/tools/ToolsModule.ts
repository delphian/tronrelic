/**
 * @fileoverview Tools module implementation.
 *
 * Provides user-facing TRON utility tools: address conversion, energy estimation,
 * bidirectional stake calculation, signature verification, token approval checking,
 * and timestamp/block conversion. Registers a "Tools" menu category with individual
 * entries for each tool.
 *
 * Also registers the stake and staking rewards calculators as embeddable
 * widgets, refreshes the staking rewards snapshot on a schedule, and runs the
 * `/system/tools` admin page, whose Bootstrap tab lets an admin create the CMS
 * pages this module ships for curator review.
 *
 * Follows TronRelic's two-phase initialization pattern with dependency injection.
 */

import type { Express } from 'express';
import type {
    ICacheService,
    IChainParametersService,
    IDatabaseService,
    IMenuService,
    IModule,
    IModuleMetadata,
    IPageBootstrapService,
    ISchedulerService,
    IServiceRegistry,
    IWidgetsService
} from '@/types';
import { TOOLS_ADMIN_SUBMENU_NAMESPACE, TOOLS_JOB_PREFIX } from '@/types';
import { logger } from '../../lib/logger.js';
import { blockchainConfig } from '../../config/blockchain.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { TransactionModel } from '../../database/models/transaction-model.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { AddressService } from './services/address.service.js';
import { CalculatorService } from './services/calculator.service.js';
import { ApprovalService } from './services/approval.service.js';
import { TimestampService } from './services/timestamp.service.js';
import { ToolsService } from './services/tools.service.js';
import { AddressOriginsService } from './services/address-origins.service.js';
import { SignatureService } from '../auth/signature.service.js';
import { ToolsController } from './api/tools.controller.js';
import { createToolsRouter } from './api/tools.router.js';
import { ToolsAdminController } from './api/ToolsAdminController.js';
import { createToolsAdminRouter } from './api/createToolsAdminRouter.js';
import { TOOLS_BOOTSTRAP_PAGES } from './services/TOOLS_BOOTSTRAP_PAGES.js';
import { STAKE_CALCULATOR_WIDGET_TYPE } from './services/STAKE_CALCULATOR_WIDGET_TYPE.js';
import { StakingRewardsService } from './services/StakingRewardsService.js';
import { createStakingRewardsWidgetType } from './services/createStakingRewardsWidgetType.js';

/** Collection name for transaction lookups used by the calculator service. */
const TRANSACTIONS_COLLECTION = 'transactions';

/**
 * The `/system/tools` tabs. Schedules and Database surface the staking rewards
 * refresh job and the collection it writes, so an operator checking why the
 * rewards look stale stays on this page; every module with an admin page has
 * a Logs tab.
 */
const TOOLS_ADMIN_SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Bootstrap', tab: 'bootstrap', icon: 'Sprout', order: 0 },
    { label: 'Schedules', tab: 'schedules', icon: 'Clock', order: 1 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 2 },
    { label: 'Logs', tab: 'logs', icon: 'ScrollText', order: 3 }
];

/** Scheduler job that recomputes every Super Representative's voter reward. */
export const STAKING_REWARDS_REFRESH_JOB = `${TOOLS_JOB_PREFIX}staking-rewards-refresh`;

/**
 * Every six hours, ten minutes past the hour. Votes move slowly and a refresh
 * costs about 130 requests on the queue block sync shares, so a tighter
 * schedule would spend that queue on changes nobody could see.
 */
const STAKING_REWARDS_REFRESH_CRON = '0 10 */6 * * *';

/**
 * Tools module dependencies for initialization.
 *
 * The tools module requires database access (for energy stats aggregation),
 * cache service (for caching energy stats), menu service (for navigation),
 * service registry (for discovering ChainParametersService), and the Express
 * app (for route mounting via IoC).
 */
export interface IToolsModuleDependencies {
    /** Database service for transaction lookups and energy stat aggregation. */
    database: IDatabaseService;
    /** Cache service for caching calculator results. */
    cacheService: ICacheService;
    /** Menu service for registering the Tools navigation category. */
    menuService: IMenuService;
    /** Service registry for discovering shared services like ChainParametersService. */
    serviceRegistry: IServiceRegistry;
    /** Express application instance for mounting routers. */
    app: Express;
    /**
     * The pages module's bootstrap service, which binds the module's CMS pages
     * into the catalog the Bootstrap tab lists and creates through. Plugins
     * reach the same service as `'page-bootstrap'`.
     */
    pageBootstrap: IPageBootstrapService;
    /** The widgets service, used to register the calculators as embeddable widgets. */
    widgetsService: IWidgetsService;
    /**
     * Scheduler the staking rewards refresh registers on. Optional so tests can
     * leave it out; with none, including `ENABLE_SCHEDULER=false`, the rewards
     * snapshot is never refreshed and the calculator says so.
     */
    scheduler?: ISchedulerService | null;
}

/**
 * Tools module for user-facing TRON utilities.
 *
 * Implements the IModule interface to provide:
 * - Address conversion between hex and base58check formats
 * - Energy estimation from historical transaction data
 * - Bidirectional stake calculator (TRX to energy and energy to TRX)
 * - TRON wallet signature verification
 *
 * ## Lifecycle
 *
 * ### init() phase:
 * - Stores injected dependencies
 * - Registers TransactionModel with database service
 * - Looks up IChainParametersService from the service registry
 * - Creates CalculatorService with cache, database, and chain parameters
 * - Creates SignatureService for wallet verification
 * - Creates ToolsController with both services
 * - Creates the staking rewards service, which owns the stored rewards snapshot
 * - Creates the bootstrap catalog and the admin controller for `/system/tools`
 * - Does NOT mount routes or register menu items
 *
 * ### run() phase:
 * - Registers "Tools" container menu node in 'main' namespace
 * - Registers child menu items for each tool
 * - Mounts tools router at /api/tools
 * - Registers the stake and staking rewards calculators as embeddable widget types
 * - Registers the staking rewards refresh job when a scheduler is present
 * - Registers the `/system/tools` menu entry and tab row, and mounts the admin router at /api/admin/tools
 */
export class ToolsModule implements IModule<IToolsModuleDependencies> {
    /** Module metadata for introspection and logging. */
    readonly metadata: IModuleMetadata = {
        id: 'tools',
        name: 'Tools',
        version: '1.2.0',
        description: 'User-facing TRON utility tools: address converter, energy estimator, stake calculator, staking rewards calculator, signature verifier, approval checker, timestamp converter'
    };

    /** Stored dependencies from init() phase. */
    private database!: IDatabaseService;
    private menuService!: IMenuService;
    private serviceRegistry!: IServiceRegistry;
    private app!: Express;
    private widgetsService!: IWidgetsService;
    private scheduler: ISchedulerService | null = null;

    /** Services created during init() phase. */
    private controller!: ToolsController;
    private toolsService!: ToolsService;
    private adminController!: ToolsAdminController;
    private stakingRewardsService!: StakingRewardsService;

    /** Logger instance for this module. */
    private readonly logger = logger.child({ module: 'tools' });

    /**
     * Initialize the tools module with injected dependencies.
     *
     * Phase 1: Prepare services without activating. Creates the calculator
     * service, signature service, and controller. Resolves ChainParametersService
     * from the service registry for live network parameters. Does NOT mount routes.
     *
     * @param dependencies - All required services
     * @throws If initialization fails or ChainParametersService is not registered
     */
    async init(dependencies: IToolsModuleDependencies): Promise<void> {
        this.logger.info('Initializing tools module...');

        this.database = dependencies.database;
        this.menuService = dependencies.menuService;
        this.serviceRegistry = dependencies.serviceRegistry;
        this.app = dependencies.app;
        this.widgetsService = dependencies.widgetsService;
        this.scheduler = dependencies.scheduler ?? null;

        this.database.registerModel(TRANSACTIONS_COLLECTION, TransactionModel);

        const chainParameters = dependencies.serviceRegistry.get<IChainParametersService>('chain-parameters');
        if (!chainParameters) {
            throw new Error('ChainParametersService not found on service registry. Ensure it is registered as "chain-parameters" before tools module init.');
        }

        const tronGridClient = TronGridClient.getInstance();
        const tronWeb = tronGridClient.createTronWeb();

        const addressService = new AddressService(tronWeb);
        this.toolsService = new ToolsService(addressService);

        const calculatorService = new CalculatorService(
            dependencies.cacheService,
            this.database,
            chainParameters
        );
        const signatureService = new SignatureService(tronWeb);
        const approvalService = new ApprovalService(TronGridClient.getInstance(), dependencies.cacheService);
        const timestampService = new TimestampService(TronGridClient.getInstance(), dependencies.cacheService);
        // Resolves the 'blockchain' service lazily per request, so no init-order
        // dependency on it being registered before the tools module. Takes the
        // address service to Base58Check-validate inputs before they climb.
        const addressOriginsService = new AddressOriginsService(dependencies.serviceRegistry, addressService);

        this.stakingRewardsService = new StakingRewardsService({
            source: tronGridClient,
            chainParameters,
            database: this.database,
            addressService,
            logger: this.logger,
            blockIntervalSeconds: blockchainConfig.network.blockIntervalSeconds
        });

        this.controller = new ToolsController(
            addressService, calculatorService, signatureService,
            approvalService, timestampService, addressOriginsService,
            this.stakingRewardsService
        );

        const bootstrapCatalog = dependencies.pageBootstrap.createCatalog(TOOLS_BOOTSTRAP_PAGES, this.logger);
        this.adminController = new ToolsAdminController(bootstrapCatalog, this.logger);

        this.logger.info('Tools module initialized');
    }

    /**
     * Run the tools module after all modules have initialized.
     *
     * Phase 2: Register menu items and mount routes. By this point,
     * MenuService is guaranteed to be ready.
     *
     * @throws If runtime setup fails (causes application shutdown)
     */
    async run(): Promise<void> {
        this.logger.info('Running tools module...');

        this.serviceRegistry.register('tools', this.toolsService);
        this.logger.info('ToolsService registered on service registry as "tools"');

        await this.registerMenuItems();

        const router = createToolsRouter(this.controller);
        this.app.use('/api/tools', router);
        this.logger.info('Tools router mounted at /api/tools');

        this.app.use('/api/admin/tools', createAdminRateLimiter('tools-admin'), requireAdmin, createToolsAdminRouter(this.adminController));
        this.logger.info('Tools admin router mounted at /api/admin/tools');

        this.widgetsService.registerType(STAKE_CALCULATOR_WIDGET_TYPE, this.metadata.id);
        this.logger.info({ typeId: STAKE_CALCULATOR_WIDGET_TYPE.id }, 'Stake calculator registered as an embeddable widget');

        const stakingRewardsWidget = createStakingRewardsWidgetType(() => this.stakingRewardsService.getSnapshot());
        this.widgetsService.registerType(stakingRewardsWidget, this.metadata.id);
        this.logger.info({ typeId: stakingRewardsWidget.id }, 'Staking rewards calculator registered as an embeddable widget');

        await this.registerStakingRewardsRefresh();

        this.logger.info('Tools module running');
    }

    /**
     * Register the staking rewards refresh job, and start a first refresh when
     * no snapshot is stored yet so a new deployment does not wait up to six
     * hours for the calculator to show figures.
     *
     * With no scheduler nothing refreshes, which is how `ENABLE_SCHEDULER=false`
     * keeps a local backend from sending the 130 TronGrid requests. The first
     * refresh is not awaited: it takes about half a minute on the shared queue,
     * and startup must not wait on it. Its failure is logged, and the scheduled
     * run tries again.
     */
    private async registerStakingRewardsRefresh(): Promise<void> {
        if (this.scheduler) {
            // The module's logger goes with the job so the scheduler's own
            // failure entry lands on this module's Logs tab.
            this.scheduler.register(STAKING_REWARDS_REFRESH_JOB, STAKING_REWARDS_REFRESH_CRON, async () => {
                await this.stakingRewardsService.refresh();
            }, { logger: this.logger });

            const stored = await this.stakingRewardsService.getSnapshot();
            if (!stored) {
                void this.stakingRewardsService.refresh().catch(error => {
                    this.logger.error({ error }, 'First staking rewards refresh failed; the scheduled refresh will retry');
                });
            }
        } else {
            this.logger.warn('No scheduler; the staking rewards snapshot will not be refreshed');
        }
    }

    /**
     * Register the `/system/tools` entry under the System container and the
     * page's tab row as a namespaced menu.
     *
     * The tab nodes are memory-only and sit outside the System container, so
     * the container's forced `requiresAdmin` does not reach them and each node
     * sets it for itself.
     */
    private async registerAdminMenuItems(): Promise<void> {
        await this.menuService.create({
            namespace: 'main',
            label: 'Tools',
            url: '/system/tools',
            icon: 'Wrench',
            order: 60,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        for (const tab of TOOLS_ADMIN_SUBMENU_TABS) {
            await this.menuService.create({
                namespace: TOOLS_ADMIN_SUBMENU_NAMESPACE,
                label: tab.label,
                url: `/system/tools?tab=${tab.tab}`,
                icon: tab.icon,
                order: tab.order,
                parent: null,
                enabled: true,
                requiresAdmin: true
            });
        }

        this.logger.info('Tools admin menu entry and tab row registered');
    }

    /**
     * Register the Tools menu category and child items in the main namespace.
     *
     * Creates a container node with child entries for each tool page.
     * The container URL is auto-derived as '/tools' from the label.
     * Uses memory-only persistence (persist=false default) since these entries
     * are recreated on every application boot. The auto-generated category
     * landing page renders a card grid of children at the container URL.
     */
    private async registerMenuItems(): Promise<void> {
        try {
            const container = await this.menuService.create({
                namespace: 'main',
                label: 'Tools',
                // Also the /tools landing page's meta description and subtitle,
                // so keep it a full sentence under ~160 characters.
                description: 'Free TRON tools for wallets, energy, and tokens. Convert addresses, estimate energy costs, verify signatures, check token approvals, and trace wallet origins.',
                icon: 'Wrench',
                order: 60,
                parent: null,
                enabled: true
            });

            const parentId = container._id?.toString() ?? null;

            const children = [
                { label: 'Address Converter', url: '/tools/address-converter', icon: 'ArrowLeftRight', order: 10, description: 'Convert a TRON address between its Base58 form (starting with T) and its hex form (starting with 41).' },
                { label: 'Address Generator', url: '/tools/address-generator', icon: 'KeyRound', order: 15, description: 'Create a new TRON wallet with a recovery phrase, or search for a vanity address. Everything runs in your browser, so keys never leave your device.' },
                { label: 'Energy Estimator', url: '/tools/energy-estimator', icon: 'Zap', order: 20, description: 'Estimate how much energy your smart contract calls need each day, and compare staking TRX for it with burning TRX to pay the fees.' },
                { label: 'Stake Calculator', url: '/tools/stake-calculator', icon: 'Calculator', order: 30, description: 'See how much energy and bandwidth a TRX stake gives you, or how much TRX to stake for the energy you need, at live network rates.' },
                { label: 'Staking Rewards', url: '/tools/staking-rewards', icon: 'Coins', order: 35, description: 'Estimate the TRX you earn each year by voting with staked TRX, and compare every Super Representative by commission and reward rate.' },
                { label: 'Signature Verifier', url: '/tools/signature-verifier', icon: 'ShieldCheck', order: 40, description: 'Check whether a TRON wallet signed a message, to confirm who controls an address. A link carrying the wallet, message, and signature verifies on load.' },
                { label: 'Approval Checker', url: '/tools/approval-checker', icon: 'Shield', order: 45, description: 'Scan a TRON wallet\'s recent TRC20 token approvals for unlimited allowances, and see which contracts can spend its tokens.' },
                { label: 'Address Origins', url: '/tools/address-origins', icon: 'GitBranch', order: 48, description: 'Trace a TRON wallet back through the accounts that activated it to find where it came from, and spot ancestors shared by several wallets.' },
                { label: 'Timestamp Converter', url: '/tools/timestamp-converter', icon: 'Clock', order: 50, description: 'Convert between Unix timestamps, calendar dates, and TRON block numbers, in either direction.' },
            ];

            await Promise.all(children.map(child =>
                this.menuService.create({
                    namespace: 'main',
                    label: child.label,
                    description: child.description,
                    url: child.url,
                    icon: child.icon,
                    order: child.order,
                    parent: parentId,
                    enabled: true
                })
            ));

            this.logger.info('Tools menu items registered in main namespace');

            await this.registerAdminMenuItems();
        } catch (error) {
            this.logger.error({ error }, 'Failed to register tools menu items');
            throw new Error(`Failed to register tools menu items: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
