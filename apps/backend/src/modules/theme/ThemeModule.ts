import type { Express } from 'express';
import type { IDatabaseService, ICacheService, IModule, IModuleMetadata, IMenuService } from '@tronrelic/types';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { ThemeService } from './services/theme.service.js';
import { ThemeValidator } from './validators/theme.validator.js';
import { ThemeController } from './api/theme.controller.js';
import { createPublicRouter, createAdminRouter } from './api/theme.routes.js';

/**
 * Dependencies required by the theme module.
 */
export interface IThemeModuleDependencies {
    /**
     * Database service for MongoDB operations.
     */
    database: IDatabaseService;

    /**
     * Cache service for Redis operations (active theme caching).
     */
    cacheService: ICacheService;

    /**
     * Menu service for registering /system/theme navigation entry.
     */
    menuService: IMenuService;

    /**
     * Express application instance for mounting routers.
     */
    app: Express;
}

/**
 * Theme module implementation.
 *
 * Provides custom CSS theme management with dependency resolution, Redis caching,
 * and SSR injection support. Administrators can create, edit, and activate multiple
 * themes that override the application's global CSS variables. Themes support
 * dependencies to enable composition and reusability.
 *
 * The module follows TronRelic's two-phase initialization pattern with dependency injection.
 */
export class ThemeModule implements IModule<IThemeModuleDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'theme',
        name: 'Theme Management',
        version: '1.0.0',
        description: 'Custom CSS theme management with dependency resolution and SSR injection'
    };

    /**
     * Stored dependencies from init() phase.
     */
    private database!: IDatabaseService;
    private cacheService!: ICacheService;
    private menuService!: IMenuService;
    private app!: Express;

    /**
     * Services created during init() phase.
     */
    private themeService!: ThemeService;
    private validator!: ThemeValidator;
    private controller!: ThemeController;

    /**
     * Logger instance for this module.
     */
    private readonly logger = logger.child({ module: 'theme' });

    /**
     * Initialize the module with injected dependencies.
     *
     * This phase prepares the module by creating service instances and storing
     * dependencies for use in the run() phase. It does NOT mount routes or
     * register menu items yet.
     *
     * @param dependencies - Injected dependencies (database, cache, menu, app)
     */
    async init(dependencies: IThemeModuleDependencies): Promise<void> {
        this.logger.info('Initializing theme module...');

        // Store dependencies for use in run() phase
        this.database = dependencies.database;
        this.cacheService = dependencies.cacheService;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;

        // Initialize theme service singleton
        ThemeService.setDependencies(
            this.database,
            this.cacheService,
            this.logger
        );
        this.themeService = ThemeService.getInstance();

        // Create database indexes
        await this.themeService.createIndexes();

        // Create validator
        this.validator = new ThemeValidator(this.logger);

        // Create controller
        this.controller = new ThemeController(
            this.themeService,
            this.validator,
            this.logger
        );

        this.logger.info('Theme module initialized');
    }

    /**
     * Run the module after all modules have initialized.
     *
     * This phase activates the module by mounting routes and registering menu items.
     * By this point, all dependencies are guaranteed to be initialized and ready.
     */
    async run(): Promise<void> {
        this.logger.info('Running theme module...');

        // Create and mount public router
        const publicRouter = createPublicRouter(this.controller);
        this.app.use('/api/system/themes', publicRouter);
        this.logger.info('Public theme router mounted at /api/system/themes');

        // Create and mount admin router with authentication middleware
        const adminRouter = createAdminRouter(this.controller);
        this.app.use('/api/admin/system/themes', requireAdmin, adminRouter);
        this.logger.info('Admin theme router mounted at /api/admin/system/themes');

        // Register menu item in system namespace
        await this.menuService.create({
            namespace: 'system',
            label: 'Themes',
            url: '/system/theme',
            icon: 'Palette',
            order: 400,
            parent: null,
            enabled: true
        });
        this.logger.info('Theme menu item registered');

        this.logger.info('Theme module running');
    }

    /**
     * Get the theme service instance.
     *
     * Provides external access to theme service for other modules or plugins
     * that need to interact with theme data programmatically.
     *
     * @returns Theme service singleton instance
     * @throws Error if called before init()
     */
    public static getThemeService(): ThemeService {
        return ThemeService.getInstance();
    }
}
