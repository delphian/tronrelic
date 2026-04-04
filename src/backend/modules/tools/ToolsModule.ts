/**
 * @fileoverview Tools module implementation.
 *
 * Provides user-facing TRON utility tools: address conversion, energy estimation,
 * bidirectional stake calculation, and signature verification. Registers a "Tools"
 * menu category with individual entries for each tool.
 *
 * Follows TronRelic's two-phase initialization pattern with dependency injection.
 */

import type TronWeb from 'tronweb';
import type { Express } from 'express';
import type { ICacheService, IChainParametersService, IDatabaseService, IMenuService, IModule, IModuleMetadata, IServiceRegistry } from '@/types';
import { logger } from '../../lib/logger.js';
import { TransactionModel } from '../../database/models/transaction-model.js';
import { CalculatorService } from './services/calculator.service.js';
import { SignatureService } from '../auth/signature.service.js';
import { ToolsController } from './api/tools.controller.js';
import { createToolsRouter } from './api/tools.router.js';

/** Collection name for transaction lookups used by the calculator service. */
const TRANSACTIONS_COLLECTION = 'transactions';

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
 * - Does NOT mount routes or register menu items
 *
 * ### run() phase:
 * - Registers "Tools" container menu node in 'main' namespace
 * - Registers child menu items for each tool
 * - Mounts tools router at /api/tools
 */
export class ToolsModule implements IModule<IToolsModuleDependencies> {
    /** Module metadata for introspection and logging. */
    readonly metadata: IModuleMetadata = {
        id: 'tools',
        name: 'Tools',
        version: '1.0.0',
        description: 'User-facing TRON utility tools: address converter, energy estimator, stake calculator, signature verifier'
    };

    /** Stored dependencies from init() phase. */
    private database!: IDatabaseService;
    private menuService!: IMenuService;
    private app!: Express;

    /** Services created during init() phase. */
    private controller!: ToolsController;

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
        this.app = dependencies.app;

        this.database.registerModel(TRANSACTIONS_COLLECTION, TransactionModel);

        const chainParameters = dependencies.serviceRegistry.get<IChainParametersService>('chain-parameters');
        if (!chainParameters) {
            throw new Error('ChainParametersService not found on service registry. Ensure it is registered as "chain-parameters" before tools module init.');
        }

        const tronWeb = dependencies.serviceRegistry.get<TronWeb>('tronweb');
        if (!tronWeb) {
            throw new Error('TronWeb not found on service registry. Ensure it is registered as "tronweb" before tools module init.');
        }

        const calculatorService = new CalculatorService(
            dependencies.cacheService,
            this.database,
            chainParameters
        );
        const signatureService = new SignatureService(tronWeb);

        this.controller = new ToolsController(calculatorService, signatureService);

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

        await this.registerMenuItems();

        const router = createToolsRouter(this.controller);
        this.app.use('/api/tools', router);
        this.logger.info('Tools router mounted at /api/tools');

        this.logger.info('Tools module running');
    }

    /**
     * Register the Tools menu category and child items in the main namespace.
     *
     * Creates a container node (no URL) with child entries for each tool page.
     * Uses memory-only persistence (persist=false default) since these entries
     * are recreated on every application boot.
     */
    private async registerMenuItems(): Promise<void> {
        try {
            const container = await this.menuService.create({
                namespace: 'main',
                label: 'Tools',
                icon: 'Wrench',
                order: 60,
                parent: null,
                enabled: true
            });

            const parentId = container._id?.toString() ?? null;

            const children = [
                { label: 'Address Converter', url: '/tools/address-converter', icon: 'ArrowLeftRight', order: 10 },
                { label: 'Energy Estimator', url: '/tools/energy-estimator', icon: 'Zap', order: 20 },
                { label: 'Stake Calculator', url: '/tools/stake-calculator', icon: 'Calculator', order: 30 },
                { label: 'Signature Verifier', url: '/tools/signature-verifier', icon: 'ShieldCheck', order: 40 },
            ];

            for (const child of children) {
                await this.menuService.create({
                    namespace: 'main',
                    label: child.label,
                    url: child.url,
                    icon: child.icon,
                    order: child.order,
                    parent: parentId,
                    enabled: true
                });
            }

            this.logger.info('Tools menu items registered in main namespace');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register tools menu items');
            throw new Error(`Failed to register tools menu items: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
