import type { IModuleMetadata } from './IModuleMetadata.js';

/**
 * Core module interface for backend system components.
 *
 * Modules are permanent, essential backend components that initialize during application
 * bootstrap and remain active for the application's lifetime. Unlike plugins, modules
 * cannot be enabled/disabled at runtime and are considered critical infrastructure.
 *
 * ## Why Modules Exist
 *
 * Modules provide the core functionality of TronRelic:
 * - Pages: Custom content management
 * - Menu: Navigation management
 * - System Log: Logging infrastructure
 *
 * They use dependency injection and inversion of control to integrate with the application,
 * allowing them to register routes, menu items, and services without tight coupling to
 * the bootstrap process.
 *
 * ## Two-Phase Lifecycle
 *
 * Modules follow a two-phase initialization pattern to ensure proper dependency resolution:
 *
 * ### Phase 1: init(dependencies)
 * - **Purpose**: Prepare the module without starting it
 * - **Actions**: Create service instances, validate config, store dependencies
 * - **Constraints**: Cannot assume other modules are initialized
 * - **Error behavior**: Failures cause application shutdown (fatal)
 *
 * ### Phase 2: run()
 * - **Purpose**: Activate the module and integrate with the application
 * - **Actions**: Mount routes, register with services, start background tasks
 * - **Constraints**: All dependencies are guaranteed to be initialized and ready
 * - **Error behavior**: Failures cause application shutdown (fatal)
 *
 * ## Inversion of Control
 *
 * Modules receive the Express app, MenuService, and other core services as dependencies.
 * They are responsible for attaching themselves to these services (mounting routes,
 * registering menu items) rather than returning values for the bootstrap process to handle.
 *
 * This pattern:
 * - Reduces coupling between modules and bootstrap code
 * - Makes module responsibilities explicit
 * - Enables easier testing with mock dependencies
 * - Follows standard dependency injection patterns
 *
 * ## Example Implementation
 *
 * ```typescript
 * interface IPagesModuleDependencies {
 *     database: IDatabaseService;
 *     cacheService: ICacheService;
 *     menuService: IMenuService;
 *     app: Express.Application;
 * }
 *
 * class PagesModule implements IModule<IPagesModuleDependencies> {
 *     readonly metadata: IModuleMetadata = {
 *         id: 'pages',
 *         name: 'Pages',
 *         version: '1.0.0',
 *         description: 'Custom page creation and markdown rendering'
 *     };
 *
 *     private database!: IDatabaseService;
 *     private app!: Express.Application;
 *     private pageService!: PageService;
 *
 *     async init(deps: IPagesModuleDependencies): Promise<void> {
 *         // Store dependencies for use in run()
 *         this.database = deps.database;
 *         this.app = deps.app;
 *
 *         // Create services
 *         const storageProvider = new LocalStorageProvider();
 *         this.pageService = new PageService(
 *             deps.database,
 *             storageProvider,
 *             deps.cacheService,
 *             logger
 *         );
 *     }
 *
 *     async run(): Promise<void> {
 *         // Register menu item (MenuService is guaranteed ready)
 *         await deps.menuService.create({
 *             namespace: 'system',
 *             label: 'Pages',
 *             url: '/system/pages'
 *         });
 *
 *         // Create and mount routers (IoC - module attaches itself)
 *         const adminRouter = this.createAdminRouter();
 *         this.app.use('/api/admin/pages', adminRouter);
 *     }
 * }
 * ```
 *
 * ## Bootstrap Pattern
 *
 * In the application bootstrap (apps/backend/src/index.ts):
 *
 * ```typescript
 * // Instantiate modules
 * const menuModule = new MenuModule();
 * const pagesModule = new PagesModule();
 *
 * // Phase 1: Initialize (prepare resources)
 * await menuModule.init({ database, app });
 * await pagesModule.init({ database, cacheService, menuService, app });
 *
 * // Phase 2: Run (activate and integrate)
 * await menuModule.run();
 * await pagesModule.run();
 * ```
 *
 * ## Error Handling
 *
 * Modules are critical infrastructure. If init() or run() fails:
 * - Error is logged with module metadata
 * - Application shuts down (no degraded mode)
 * - No retry mechanism (fail-fast philosophy)
 *
 * This ensures the application never runs in an undefined state with missing
 * core functionality.
 *
 * @template TDependencies - Typed dependencies object specific to this module
 */
export interface IModule<TDependencies extends Record<string, any> = Record<string, any>> {
    /**
     * Module metadata for introspection.
     *
     * Provides identifying information used for logging, debugging, and future
     * administrative interfaces. Should be a readonly property set during module
     * construction.
     */
    readonly metadata: IModuleMetadata;

    /**
     * Initialize the module with injected dependencies.
     *
     * This is the first phase of the two-phase lifecycle. The module should prepare
     * itself but NOT activate or integrate with the application yet.
     *
     * ## Responsibilities
     *
     * The init phase should:
     * - **Store injected dependencies** as private class properties for use in run()
     * - **Create service instances** (but don't register them with other services yet)
     * - **Validate configuration** (check required environment variables, settings)
     * - **Prepare resources** (but don't start background tasks)
     *
     * The init phase must NOT:
     * - Mount routes on the Express app (wait for run())
     * - Register menu items with MenuService (wait for run())
     * - Register observers with ObserverRegistry (wait for run())
     * - Start background tasks or cron jobs (wait for run())
     * - Assume other modules are initialized (only your own dependencies)
     *
     * ## Dependency Injection Pattern
     *
     * Dependencies are passed as a typed object. Each module defines its own
     * dependencies interface:
     *
     * ```typescript
     * interface IMyModuleDependencies {
     *     database: IDatabaseService;
     *     app: Express.Application;
     *     menuService: IMenuService;
     * }
     *
     * class MyModule implements IModule<IMyModuleDependencies> {
     *     private database!: IDatabaseService;
     *
     *     async init(deps: IMyModuleDependencies): Promise<void> {
     *         this.database = deps.database;  // Store for later use
     *         this.myService = new MyService(deps.database);
     *     }
     * }
     * ```
     *
     * ## Error Handling
     *
     * If initialization fails, throw an error with a descriptive message. The error
     * will be caught by the bootstrap process, logged with module metadata, and
     * cause application shutdown.
     *
     * ```typescript
     * async init(deps: IMyModuleDependencies): Promise<void> {
     *     if (!deps.database) {
     *         throw new Error('Database dependency is required');
     *     }
     *
     *     try {
     *         await this.validateConfig();
     *     } catch (error) {
     *         throw new Error(`Configuration validation failed: ${error.message}`);
     *     }
     * }
     * ```
     *
     * @param dependencies - Typed dependencies object specific to this module
     * @throws {Error} If initialization fails (causes application shutdown)
     */
    init(dependencies: TDependencies): Promise<void>;

    /**
     * Run the module after all modules have initialized.
     *
     * This is the second phase of the two-phase lifecycle. The module should activate
     * itself and integrate with the application. By this point, all injected dependencies
     * are guaranteed to be initialized and ready.
     *
     * ## Responsibilities
     *
     * The run phase should:
     * - **Mount routes** on the Express app using the stored app reference (IoC pattern)
     * - **Register menu items** with MenuService (service is guaranteed ready)
     * - **Register observers** with ObserverRegistry (registry is guaranteed ready)
     * - **Start background tasks** if the module manages scheduled jobs
     *
     * ## Inversion of Control
     *
     * The module is responsible for attaching itself to the application, not returning
     * values for the bootstrap process to handle:
     *
     * ```typescript
     * async run(): Promise<void> {
     *     // Create routers
     *     const adminRouter = this.createAdminRouter();
     *     const publicRouter = this.createPublicRouter();
     *
     *     // Module mounts its own routes (IoC)
     *     this.app.use('/api/admin/pages', adminRouter);
     *     this.app.use('/api/pages', publicRouter);
     *
     *     // Module registers its own menu items (IoC)
     *     await this.menuService.create({
     *         namespace: 'system',
     *         label: 'Pages',
     *         url: '/system/pages'
     *     });
     * }
     * ```
     *
     * ## Dependency Guarantees
     *
     * By the time run() is called, all modules have completed init(). This means:
     * - MenuService is fully initialized (no need for 'ready' event subscriptions)
     * - All other injected dependencies are ready to use
     * - Database connections are established
     * - Redis cache is available
     *
     * ## Error Handling
     *
     * If run() fails, throw an error with a descriptive message. The error will be
     * caught by the bootstrap process, logged with module metadata, and cause
     * application shutdown.
     *
     * ```typescript
     * async run(): Promise<void> {
     *     try {
     *         await this.menuService.create({ ... });
     *     } catch (error) {
     *         throw new Error(`Failed to register menu item: ${error.message}`);
     *     }
     *
     *     this.app.use('/api/pages', this.createRouter());
     * }
     * ```
     *
     * @throws {Error} If runtime setup fails (causes application shutdown)
     */
    run(): Promise<void>;
}
