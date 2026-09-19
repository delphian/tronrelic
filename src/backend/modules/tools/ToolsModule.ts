/**
 * @fileoverview Tools module implementation.
 *
 * Provides user-facing TRON utility tools: address conversion, energy estimation,
 * bidirectional stake calculation, signature verification, token approval checking,
 * and timestamp/block conversion. Registers a "Tools" menu category with individual
 * entries for each tool.
 *
 * Follows TronRelic's two-phase initialization pattern with dependency injection.
 */

import type { Express } from 'express';
import type { ICacheService, IChainParametersService, IDatabaseService, IMenuService, IModule, IModuleMetadata, IServiceRegistry } from '@/types';
import { logger } from '../../lib/logger.js';
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
        version: '1.1.0',
        description: 'User-facing TRON utility tools: address converter, energy estimator, stake calculator, signature verifier, approval checker, timestamp converter'
    };

    /** Stored dependencies from init() phase. */
    private database!: IDatabaseService;
    private menuService!: IMenuService;
    private serviceRegistry!: IServiceRegistry;
    private app!: Express;

    /** Services created during init() phase. */
    private controller!: ToolsController;
    private toolsService!: ToolsService;

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

        this.controller = new ToolsController(
            addressService, calculatorService, signatureService,
            approvalService, timestampService, addressOriginsService
        );

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

        this.logger.info('Tools module running');
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
                { label: 'Energy Estimator', url: '/tools/energy-estimator', icon: 'Zap', order: 20, description: 'Estimate how much energy your smart contract calls need each day, and compare the cost of staking TRX with renting energy.' },
                { label: 'Stake Calculator', url: '/tools/stake-calculator', icon: 'Calculator', order: 30, description: 'See how much energy and bandwidth a TRX stake gives you, or how much TRX to stake for the energy you need, at live network rates.' },
                { label: 'Signature Verifier', url: '/tools/signature-verifier', icon: 'ShieldCheck', order: 40, description: 'Check whether a TRON wallet signed a message, to confirm who controls an address. Share any result as a link.' },
                { label: 'Approval Checker', url: '/tools/approval-checker', icon: 'Shield', order: 45, description: 'Find every TRC20 token approval on a TRON wallet, including unlimited allowances, and see which contracts can spend its tokens.' },
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
        } catch (error) {
            this.logger.error({ error }, 'Failed to register tools menu items');
            throw new Error(`Failed to register tools menu items: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
