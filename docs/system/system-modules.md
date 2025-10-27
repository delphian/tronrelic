# Backend Module System

TronRelic's module system provides a structured pattern for permanent, core backend components that initialize during application bootstrap and remain active for the application's lifetime. Unlike plugins which can be enabled/disabled at runtime, modules are essential infrastructure that the application cannot function without.

## Who This Document Is For

Backend developers creating new core functionality, maintainers understanding application architecture, and engineers migrating features from unstructured code into the modular framework.

## Why This System Matters

Before the module system, core features like custom pages, navigation menus, and system logging lived in scattered locations—some in `services/`, others in `api/`, with dependencies hardcoded in the bootstrap file. This created maintainability problems:

- **Unclear initialization order** - Dependencies between features were implicit, causing race conditions
- **Tight coupling** - Services imported concrete implementations, making testing difficult
- **Fragmented organization** - Related code scattered across multiple directories (routes, services, models)
- **Bootstrap bloat** - The main `index.ts` file grew increasingly complex as features were added
- **No lifecycle management** - Features had no standardized way to prepare resources before activation

The module system solves these problems by providing:

- **Two-phase lifecycle** - Explicit `init()` and `run()` phases ensure proper dependency resolution
- **Dependency injection** - Modules receive typed dependencies, enabling testability and decoupling
- **Inversion of Control** - Modules attach themselves to the application (mount routes, register menu items) rather than returning values for bootstrap code to handle
- **Colocated organization** - All module code lives in a single `modules/<name>/` directory
- **Standardized patterns** - Every module follows the same `IModule` interface contract

## Module System Overview

### Core Architectural Principles

**1. Permanent, essential infrastructure**
Modules are not optional features. If a module fails to initialize, the application shuts down immediately. This fail-fast philosophy prevents the system from running in undefined states with missing functionality.

**2. Two-phase lifecycle**
Modules initialize in two distinct phases:
- **init()** - Prepare resources without activating (create services, validate config, store dependencies)
- **run()** - Activate and integrate with application (mount routes, register menu items, start background tasks)

This separation ensures all modules can prepare themselves before any module begins interacting with shared services.

**3. Dependency injection**
Modules declare their dependencies through typed interfaces. The bootstrap process constructs these dependencies and injects them during the `init()` phase. Modules never import concrete implementations directly.

**4. Inversion of Control (IoC)**
Modules are responsible for attaching themselves to the application. Instead of returning routers for the bootstrap code to mount, modules receive the Express app as a dependency and mount their own routes. This makes module responsibilities explicit and reduces coupling to bootstrap logic.

**5. Colocated file structure**
Each module owns its complete directory structure:
```
modules/pages/
├── api/                     # HTTP interface (controllers, routes)
├── database/                # MongoDB schemas and models
├── services/                # Business logic layer
├── __tests__/              # Unit and integration tests
├── PagesModule.ts          # IModule implementation
├── index.ts                # Public API exports
└── README.md               # Module-specific documentation
```

This organization keeps related code together and makes feature boundaries clear.

## Module Architecture

### IModule Interface Contract

All modules implement the `IModule<TDependencies>` interface from `@tronrelic/types`:

```typescript
interface IModule<TDependencies extends Record<string, any> = Record<string, any>> {
    /**
     * Module metadata for introspection.
     */
    readonly metadata: IModuleMetadata;

    /**
     * Initialize the module with injected dependencies.
     * This is phase 1: prepare resources without activating.
     */
    init(dependencies: TDependencies): Promise<void>;

    /**
     * Run the module after all modules have initialized.
     * This is phase 2: activate and integrate with the application.
     */
    run(): Promise<void>;
}
```

**Key characteristics:**
- **Generic typed dependencies** - Each module defines its own `TDependencies` interface specifying exactly what it needs
- **Async lifecycle hooks** - Both `init()` and `run()` return promises, allowing for database operations, file I/O, or service initialization
- **Fail-fast error handling** - Errors thrown from either hook cause application shutdown (no degraded mode)

### IModuleMetadata Structure

Every module exposes metadata for introspection, logging, and future administrative interfaces:

```typescript
interface IModuleMetadata {
    /**
     * Unique identifier (lowercase kebab-case matching directory name).
     * @example 'pages', 'menu', 'system-log'
     */
    id: string;

    /**
     * Human-readable module name.
     * @example 'Pages', 'Menu Service', 'System Logs'
     */
    name: string;

    /**
     * Semantic version string.
     * @example '1.0.0', '2.1.3'
     */
    version: string;

    /**
     * Optional human-readable description.
     */
    description?: string;
}
```

Metadata should be declared as a `readonly` property set during module construction, ensuring it remains constant throughout the module's lifetime.

### Module Registration and Initialization Flow

The application bootstrap (`apps/backend/src/index.ts`) follows a strict sequence:

**1. Core infrastructure startup**
```typescript
// Establish fundamental services
await connectDatabase();
const redis = createRedisClient();
await redis.connect();
await logger.initialize(pinoLogger);
```

**2. Create core service instances**
```typescript
// Instantiate singletons that modules depend on
const coreDatabase = new DatabaseService();
SystemConfigService.initialize(configLogger, coreDatabase);
BlockchainObserverService.initialize(observerLogger);

// Initialize WebSocket BEFORE loading modules
if (env.ENABLE_WEBSOCKETS) {
    WebSocketService.getInstance().initialize(server);
}

// Initialize MenuService with database dependency
const menuDatabase = new DatabaseService({ prefix: 'core_' });
MenuService.setDatabase(menuDatabase);
const menuService = MenuService.getInstance();
await menuService.initialize();
```

**3. Phase 1: Module initialization (init)**
```typescript
// Instantiate modules
const pagesModule = new PagesModule();

// Initialize (prepare resources)
await pagesModule.init({
    database: coreDatabase,
    cacheService: cacheService,
    menuService: menuService,
    app: app
});
```

At this point, the module has created its services and stored dependencies, but has NOT mounted routes or registered menu items yet.

**4. Phase 2: Module runtime activation (run)**
```typescript
// Run (activate and integrate)
await pagesModule.run();
```

Now the module mounts its routes, registers menu items, and performs any final integration steps. All dependencies are guaranteed to be initialized and ready.

**5. Start application server**
```typescript
// Load plugins (separate from core modules)
await loadPlugins();

// Initialize scheduled jobs
await initializeJobs();

// Start HTTP server
server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Server listening');
});
```

This sequence ensures proper dependency resolution: core infrastructure → modules → plugins → jobs → server.

### Dependency Injection Pattern

Each module defines its own dependencies interface that specifies exactly what it needs:

```typescript
/**
 * Pages module dependencies for initialization.
 */
export interface IPagesModuleDependencies {
    /**
     * Database service for MongoDB operations.
     */
    database: IDatabaseService;

    /**
     * Cache service for rendered HTML and computed values.
     */
    cacheService: ICacheService;

    /**
     * Menu service for registering /system/pages navigation entry.
     */
    menuService: IMenuService;

    /**
     * Express application instance for mounting routers.
     */
    app: Express;
}
```

**Benefits of typed dependencies:**
- **Explicit contracts** - Module requirements are documented in code
- **Type safety** - Compiler prevents missing or incorrect dependencies
- **Testing support** - Dependencies can be mocked by implementing the interface
- **Decoupling** - Modules depend on abstractions (`IDatabaseService`), not concrete implementations

**Anti-pattern to avoid:**
```typescript
// BAD - Direct import of concrete implementation
import { DatabaseService } from '../../services/database/database.service.js';

class MyModule {
    async init() {
        const db = new DatabaseService();  // Hardcoded dependency
        // ...
    }
}
```

**Correct pattern:**
```typescript
// GOOD - Dependency injection via constructor/init
class MyModule implements IModule<IMyModuleDependencies> {
    private database!: IDatabaseService;

    async init(deps: IMyModuleDependencies): Promise<void> {
        this.database = deps.database;  // Injected dependency
        // ...
    }
}
```

### Relationship to Application Bootstrap Sequence

Modules fit into the larger bootstrap process:

```
1. Database connection
2. Redis connection
3. Logger initialization
4. System config service
5. Migration system
6. Blockchain observer service
7. Express app creation
8. HTTP server creation
9. WebSocket initialization ← BEFORE modules
10. MenuService initialization ← BEFORE modules
11. Module init() phase ← Prepare resources
12. Module run() phase  ← Activate and integrate
13. Plugin loading
14. Job scheduler initialization
15. Server listening
```

This sequence guarantees that modules can safely use MenuService, WebSocketService, and other core infrastructure during their `run()` phase.

## Creating a New Module

Follow this step-by-step workflow to create a well-structured module:

### Step 1: Define Module Structure

Create directory and files:
```bash
mkdir -p apps/backend/src/modules/my-feature/{api,database,services,__tests__}
touch apps/backend/src/modules/my-feature/{MyFeatureModule.ts,index.ts,README.md}
```

### Step 2: Define Dependencies Interface

In `MyFeatureModule.ts`, declare what your module needs:

```typescript
import type { Express } from 'express';
import type { IDatabaseService, ICacheService, IModule, IModuleMetadata } from '@tronrelic/types';

/**
 * Dependencies required by the my-feature module.
 */
export interface IMyFeatureDependencies {
    /**
     * Database service for persistent storage.
     */
    database: IDatabaseService;

    /**
     * Cache service for performance optimization.
     */
    cacheService: ICacheService;

    /**
     * Express application for mounting routes.
     */
    app: Express;
}
```

### Step 3: Implement Module Class

Implement `IModule<IMyFeatureDependencies>`:

```typescript
/**
 * MyFeature module implementation.
 *
 * Provides [describe what the module does and why it exists].
 * The module follows TronRelic's two-phase initialization pattern with dependency injection.
 */
export class MyFeatureModule implements IModule<IMyFeatureDependencies> {
    /**
     * Module metadata for introspection and logging.
     */
    readonly metadata: IModuleMetadata = {
        id: 'my-feature',
        name: 'My Feature',
        version: '1.0.0',
        description: 'Brief description of module purpose'
    };

    /**
     * Stored dependencies from init() phase.
     */
    private database!: IDatabaseService;
    private cacheService!: ICacheService;
    private app!: Express;

    /**
     * Services created during init() phase.
     */
    private myService!: MyService;
    private controller!: MyController;

    /**
     * Logger instance for this module.
     */
    private readonly logger = logger.child({ module: 'my-feature' });

    /**
     * Initialize the module with injected dependencies.
     *
     * This phase prepares the module by creating service instances and storing
     * dependencies for use in the run() phase. It does NOT mount routes or
     * register menu items yet.
     */
    async init(dependencies: IMyFeatureDependencies): Promise<void> {
        this.logger.info('Initializing my-feature module...');

        // Store dependencies for use in run() phase
        this.database = dependencies.database;
        this.cacheService = dependencies.cacheService;
        this.app = dependencies.app;

        // Create services (but don't register them yet)
        this.myService = new MyService(
            this.database,
            this.cacheService,
            this.logger
        );

        // Create controller
        this.controller = new MyController(this.myService, this.logger);

        this.logger.info('My-feature module initialized');
    }

    /**
     * Run the module after all modules have initialized.
     *
     * This phase activates the module by mounting routes and performing any
     * final integration steps. By this point, all dependencies are guaranteed
     * to be initialized and ready.
     */
    async run(): Promise<void> {
        this.logger.info('Running my-feature module...');

        // Create and mount routers (IoC - module attaches itself to app)
        const router = this.createRouter();
        this.app.use('/api/my-feature', router);
        this.logger.info('My-feature router mounted at /api/my-feature');

        this.logger.info('My-feature module running');
    }

    /**
     * Create the router with all endpoints.
     *
     * This is an internal helper method called during the run() phase.
     */
    private createRouter(): Router {
        const router = Router();

        // Register routes using controller methods
        router.get('/', this.controller.getItems.bind(this.controller));
        router.post('/', this.controller.createItem.bind(this.controller));

        return router;
    }
}
```

### Step 4: Create Public API Exports

In `index.ts`, export only necessary types and classes:

```typescript
// Primary module export (implements IModule)
export { MyFeatureModule } from './MyFeatureModule.js';
export type { IMyFeatureDependencies } from './MyFeatureModule.js';

// Services (for external consumers if needed)
export { MyService } from './services/my.service.js';

// HTTP layer (for testing or custom configurations)
export { MyController } from './api/my.controller.js';

// Database types (for external consumers)
export type { IMyFeatureDocument } from './database/index.js';
```

### Step 5: Implement Business Logic Layer

Create services that handle domain logic.

**Design decision**: If you're creating a service with an `IXxxService` interface, it **must be a singleton**. See "Service Types and Singleton Usage" in Best Practices for the complete rule.

```typescript
// services/my.service.ts
import type { IDatabaseService, ICacheService, IMyService } from '@tronrelic/types';
import type { ISystemLogService } from '@tronrelic/types';

/**
 * Service for managing my-feature domain logic.
 *
 * Implements IMyService interface to provide an opinionated API contract.
 * This is a singleton service ensuring consistent business logic enforcement
 * across all consumers.
 */
export class MyService implements IMyService {
    private static instance: MyService;
    private readonly collection;

    /**
     * Create a my-feature service.
     *
     * @param database - Database service for MongoDB operations
     * @param cacheService - Redis cache for computed values
     * @param logger - System log service for error tracking
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection('my_feature_items');
    }

    /**
     * Get all items with optional filtering.
     */
    async getItems(filter: Record<string, any> = {}): Promise<any[]> {
        return this.collection.find(filter).toArray();
    }

    /**
     * Create a new item with validation.
     */
    async createItem(data: any): Promise<any> {
        // Validate input
        if (!data.name) {
            throw new Error('Name is required');
        }

        // Insert into database
        const result = await this.collection.insertOne(data);

        // Invalidate cache
        await this.cacheService.invalidate('my-feature:*');

        return { _id: result.insertedId, ...data };
    }
}
```

### Step 6: Create HTTP Controller

Define Express route handlers:

```typescript
// api/my.controller.ts
import type { Request, Response } from 'express';
import type { MyService } from '../services/my.service.js';
import type { ISystemLogService } from '@tronrelic/types';

/**
 * HTTP controller for my-feature endpoints.
 *
 * Handles request parsing, response formatting, and error handling.
 * Business logic is delegated to MyService.
 */
export class MyController {
    constructor(
        private readonly myService: MyService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /api/my-feature
     * List all items.
     */
    async getItems(req: Request, res: Response): Promise<void> {
        try {
            const items = await this.myService.getItems();
            res.json({ items });
        } catch (error) {
            this.logger.error({ error }, 'Failed to get items');
            res.status(500).json({ error: 'Failed to get items' });
        }
    }

    /**
     * POST /api/my-feature
     * Create a new item.
     */
    async createItem(req: Request, res: Response): Promise<void> {
        try {
            const item = await this.myService.createItem(req.body);
            res.status(201).json({ item });
        } catch (error) {
            this.logger.error({ error }, 'Failed to create item');
            res.status(400).json({ error: error.message });
        }
    }
}
```

### Step 7: Define Database Schema

Create MongoDB models:

```typescript
// database/index.ts
import type { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for my-feature items.
 */
export interface IMyFeatureDocument {
    _id: ObjectId;
    name: string;
    description: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Default configuration for my-feature.
 */
export const DEFAULT_MY_FEATURE_SETTINGS = {
    maxItems: 100,
    enableCaching: true
};
```

### Step 8: Register Module in Bootstrap

In `apps/backend/src/index.ts`, add module initialization:

```typescript
import { MyFeatureModule } from './modules/my-feature/index.js';

// Inside bootstrap() function, after MenuService initialization:

// Create cache service from Redis
const redis = getRedisClient();
const cacheService = new CacheService(redis);

// Instantiate module
const myFeatureModule = new MyFeatureModule();

// Phase 1: Initialize (create services, prepare resources)
await myFeatureModule.init({
    database: coreDatabase,
    cacheService: cacheService,
    app: app
});

// Phase 2: Run (mount routes, register menu items)
await myFeatureModule.run();

logger.info({}, 'MyFeatureModule initialized and running');
```

### Step 9: Write Tests

Create comprehensive tests for the module lifecycle:

```typescript
// __tests__/my-feature.module.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MyFeatureModule } from '../index.js';
import type { IDatabaseService, ICacheService } from '@tronrelic/types';

describe('MyFeatureModule', () => {
    let mockDatabase: IDatabaseService;
    let mockCache: ICacheService;
    let mockApp: any;

    beforeEach(() => {
        // Create mocks
        mockDatabase = createMockDatabase();
        mockCache = createMockCache();
        mockApp = { use: vi.fn() };
    });

    describe('metadata', () => {
        it('should have correct module metadata', () => {
            const module = new MyFeatureModule();

            expect(module.metadata.id).toBe('my-feature');
            expect(module.metadata.name).toBe('My Feature');
            expect(module.metadata.version).toBe('1.0.0');
        });
    });

    describe('init()', () => {
        it('should initialize without errors', async () => {
            const module = new MyFeatureModule();

            await expect(module.init({
                database: mockDatabase,
                cacheService: mockCache,
                app: mockApp
            })).resolves.not.toThrow();
        });

        it('should NOT mount routes during init()', async () => {
            const module = new MyFeatureModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                app: mockApp
            });

            expect(mockApp.use).not.toHaveBeenCalled();
        });
    });

    describe('run()', () => {
        it('should throw if run() is called before init()', async () => {
            const module = new MyFeatureModule();
            await expect(module.run()).rejects.toThrow();
        });

        it('should mount routes during run()', async () => {
            const module = new MyFeatureModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                app: mockApp
            });

            await module.run();

            expect(mockApp.use).toHaveBeenCalledWith(
                '/api/my-feature',
                expect.any(Function)
            );
        });
    });

    describe('two-phase lifecycle', () => {
        it('should complete full init -> run flow', async () => {
            const module = new MyFeatureModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                app: mockApp
            });

            await module.run();

            expect(mockApp.use).toHaveBeenCalled();
        });
    });
});
```

### Step 10: Document the Module

Create `README.md` in the module directory following the pattern established in `modules/pages/README.md`:

- Who the document is for
- Why the module exists
- Architecture overview
- Core components with examples
- Public API exports
- Usage examples
- Pre-implementation checklist
- Related documentation links

## Pages Module: Reference Implementation

The pages module (`apps/backend/src/modules/pages/`) serves as the canonical example of module architecture patterns. It demonstrates:

### Service Composition Pattern

The pages module shows how to compose multiple services with clear responsibility boundaries:

```typescript
// PagesModule.init() creates services with dependency injection
const storageProvider = new LocalStorageProvider();

this.pageService = new PageService(
    this.database,
    storageProvider,
    this.cacheService,
    this.logger
);

this.controller = new PagesController(this.pageService, this.logger);
```

**Key pattern**: PageService orchestrates business logic but delegates infrastructure concerns:
- **Database operations** - Handled by `IDatabaseService` (MongoDB abstraction)
- **File storage** - Handled by `IStorageProvider` (pluggable local/S3/Cloudflare backends)
- **Markdown rendering** - Handled by `MarkdownService` (caching HTML in Redis)
- **HTTP interface** - Handled by `PagesController` (request/response formatting)

**Important distinction**: PageService is a **singleton service** that implements `IPageService`, providing an opinionated API contract for page management. Like all services with `IXxxService` interfaces (MenuService, PageService, etc.), it uses the singleton pattern to ensure consistent business logic enforcement across all consumers. External modules and plugins can access it via `PagesModule.getPageService()` to call methods like `pageService.createPage()` directly. See "Service Types and Singleton Usage" in Best Practices for the decision criteria.

This separation enables:
- Testing services in isolation with mocks
- Swapping storage providers without changing business logic
- Independent evolution of infrastructure and domain layers

### Storage Provider Abstraction

The pages module demonstrates the "Provider" vs "Service" pattern:

**Providers signal:**
- Pluggability (multiple implementations can coexist)
- Clear abstraction boundary (infrastructure vs business logic)
- Dependency injection friendly (concrete providers injected via constructor)

**Services handle:**
- Business logic (page CRUD, slug validation, frontmatter parsing)
- Orchestration (coordinate between database, storage providers, cache)
- Domain rules (blacklist patterns, file size limits, publish status checks)

**Example from pages module:**
```typescript
// StorageProvider abstract base class
abstract class StorageProvider implements IStorageProvider {
    abstract upload(file: Buffer, filename: string, mimeType: string): Promise<string>;
    abstract delete(path: string): Promise<void>;
    abstract getUrl(path: string): string;
}

// Concrete implementation
class LocalStorageProvider extends StorageProvider {
    async upload(file: Buffer, filename: string, mimeType: string): Promise<string> {
        const datePath = `${year}/${month}`;
        await fs.mkdir(`public/uploads/${datePath}`, { recursive: true });
        await fs.writeFile(`public/uploads/${datePath}/${filename}`, file);
        return `/uploads/${datePath}/${filename}`;
    }
}

// Injected into PageService
const pageService = new PageService(database, storageProvider, cache, logger);
```

This pattern enables configuration-based provider switching without changing PageService code.

### API Route Registration

The pages module uses IoC for route mounting:

```typescript
async run(): Promise<void> {
    // Create routers
    const adminRouter = this.createAdminRouter();
    const publicRouter = this.createPublicRouter();

    // Module mounts its own routes (IoC pattern)
    this.app.use('/api/admin/pages', adminRouter);
    this.app.use('/api/pages', publicRouter);
}
```

**Benefits:**
- Module controls its own namespace (`/api/admin/pages`)
- No need to return routers for bootstrap to mount
- Clear responsibility: module owns its integration

### Database Access Patterns

The pages module shows proper collection usage:

```typescript
constructor(
    private readonly database: IDatabaseService,
    private readonly storageProvider: IStorageProvider,
    private readonly cacheService: ICacheService,
    private readonly logger: ISystemLogService
) {
    // Get typed collections in constructor
    this.pagesCollection = database.getCollection<IPageDocument>('pages');
    this.filesCollection = database.getCollection<IPageFileDocument>('page_files');
    this.settingsCollection = database.getCollection<IPageSettingsDocument>('page_settings');
}

// Use collections in methods
async getPageBySlug(slug: string): Promise<IPage | null> {
    return this.pagesCollection.findOne({ slug, published: true });
}
```

**Pattern benefits:**
- Type-safe collection access with generics
- Collections initialized once in constructor
- Database operations abstracted behind `IDatabaseService` interface

### Testing Strategies Demonstrated

The pages module test suite (`__tests__/pages.module.test.ts`) shows:

**1. Mock creation for all dependencies:**
```typescript
class MockDatabaseService implements IDatabaseService {
    private collections = new Map<string, any[]>();

    getCollection<T>(name: string) {
        // Return mock collection with chainable query methods
    }
}
```

**2. Phase separation testing:**
```typescript
describe('init()', () => {
    it('should NOT mount routes during init()', async () => {
        await module.init(deps);
        expect(mockApp.use).not.toHaveBeenCalled();
    });
});

describe('run()', () => {
    it('should mount routes during run()', async () => {
        await module.init(deps);
        await module.run();
        expect(mockApp.use).toHaveBeenCalled();
    });
});
```

**3. Lifecycle validation:**
```typescript
it('should throw if run() is called before init()', async () => {
    const module = new PagesModule();
    await expect(module.run()).rejects.toThrow();
});
```

**4. Dependency injection verification:**
```typescript
it('should use injected menu service', async () => {
    await module.init(deps);
    await module.run();
    expect(mockMenu.create).toHaveBeenCalled();
});
```

## Module vs Plugin Decision Matrix

Choosing between a module and a plugin depends on the feature's characteristics:

### Use a Module When:

✅ **Feature is essential infrastructure**
The application cannot function without it (e.g., pages, menus, system logging).

✅ **Feature needs application lifecycle control**
Must initialize early in bootstrap, before plugins load.

✅ **Feature provides services with IXxxService interfaces**
Other modules or plugins need to **call methods directly** on services implementing `IXxxService` interfaces (e.g., `IMenuService`, `IPageService`). These services must be singletons to provide consistent opinionated API contracts. See "Service Types and Singleton Usage" in Best Practices for implementation guidance.

✅ **Feature cannot be disabled**
No valid use case for turning it off in production.

✅ **Feature is deeply integrated**
Requires access to Express app, core database, or other fundamental infrastructure.

**Examples:**
- Pages module (custom content management)
- Menu module (navigation system)
- Migrations module (database schema evolution)

### Use a Plugin When:

✅ **Feature is optional**
Application functions normally without it (e.g., Telegram bot, whale alerts).

✅ **Feature can be enabled/disabled at runtime**
Administrators should control activation via `/system/plugins` UI.

✅ **Feature is domain-specific**
Solves a specific blockchain analysis problem (e.g., delegation tracking, USDT monitoring).

✅ **Feature is self-contained**
All dependencies are injected through plugin context; doesn't provide shared services.

✅ **Feature includes frontend UI**
Has colocated frontend pages, components, and WebSocket handlers.

**Examples:**
- Telegram Bot plugin (notifications)
- Whale Alerts plugin (large transaction tracking)
- Energy Delegation plugin (rental analysis)

### Migration Considerations

**Moving from Plugin to Module:**

If a plugin becomes critical infrastructure:

1. Create module directory structure
2. Implement `IModule` interface
3. Define typed dependencies
4. Move business logic to services layer
5. Remove plugin lifecycle hooks (replace with module `init()`/`run()`)
6. Update bootstrap to initialize module before plugins
7. Update documentation to reflect module status

**Moving from Module to Plugin:**

If a module becomes optional:

1. Create plugin manifest with `backend` flag
2. Implement plugin lifecycle hooks (`init`, `enable`, `disable`, `uninstall`)
3. Replace typed dependencies with `IPluginContext`
4. Move menu registration to plugin `enable()` hook
5. Add database migration for plugin state tracking
6. Update bootstrap to remove module initialization
7. Document plugin activation procedure

## Best Practices

### Dependency Injection Guidelines

**✅ DO:**
- Accept dependencies through `init()` method parameters
- Store dependencies as private class properties for use in `run()`
- Depend on interfaces (`IDatabaseService`), not concrete classes
- Use typed dependency interfaces specific to each module

**❌ DON'T:**
- Import and instantiate dependencies directly
- Use global singletons except for logger
- Access dependencies before `init()` completes
- Assume other modules are initialized during `init()` phase

### Service Composition Patterns

**✅ DO:**
- Create services in `init()`, register them in `run()`
- Pass all dependencies to service constructors (dependency injection)
- Keep services focused on single responsibilities
- Use abstract base classes for pluggable infrastructure (storage providers, adapters)

**❌ DON'T:**
- Create services in `run()` phase (too late)
- Let services import concrete dependencies directly
- Mix infrastructure concerns with business logic
- Create module-owned services as singletons (prefer dependency injection)

#### Service Types and Singleton Usage

**Services (with IXxxService interfaces) MUST be singletons.** Services are public APIs that maintain **shared single state**. All consumers use the same instance with the same configuration.

---

**💡 Quick Rule:**

| Pattern | What Is It? | Singleton? | Customizable? |
|---------|-------------|------------|---------------|
| **Service** (IXxxService) | Public API with shared single state | ✅ Yes | ❌ No - configured once at bootstrap |
| **Utility** (no interface) | Tool for consumer's own use | ❌ No | ✅ Yes - each consumer configures their own |

**Key insight:** Services are configured **once during bootstrap**; consumers get the shared instance as-is. Utilities are configured **by each consumer** for their own needs.

---

**The Singleton Rule:**

A service is a **public API with shared single state**:
- Implements an `IXxxService` interface (e.g., `IPageService`, `IMenuService`)
- Configuration happens **once during bootstrap** via dependency injection
- **Consumers cannot customize it** - they get the shared instance as-is
- All consumers interact with the same state and behavior

**Exception:** `ISystemLogService` gets a "double take" because of its `child()` method, which appears to allow customization. However, `child()` just creates scoped views of the same underlying logging system—it's not true per-consumer customization.

**Services vs Utilities:**

```typescript
// ✅ CORRECT - Service with IXxxService interface = Singleton
export class PageService implements IPageService {
    private static instance: PageService;

    private constructor(
        private readonly database: IDatabaseService,
        private readonly storageProvider: IStorageProvider,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) { }

    public static setDependencies(...deps): void {
        if (!PageService.instance) {
            PageService.instance = new PageService(...deps);
        }
    }

    public static getInstance(): PageService {
        if (!PageService.instance) {
            throw new Error('setDependencies() must be called first');
        }
        return PageService.instance;
    }

    // Opinionated business logic enforcing rules
    async createPage(data: IPage): Promise<IPage> {
        // Validation, slug checking, frontmatter parsing
        // All consumers get the same behavior
    }
}
```

```typescript
// ✅ CORRECT - Utility class (NO IXxxService) = Regular instantiation
export class ValidationHelper {
    // Flexible utility - calling code uses it however they want
    constructor(private readonly config: ValidationConfig) { }

    validate(input: string): boolean {
        // No enforced business rules - customizable behavior
        return this.config.pattern.test(input);
    }
}
```

**Why Services Must Be Singletons:**

1. **Public API** - Services expose functionality to external consumers (modules, plugins)
2. **Shared Single State** - Everyone uses the same instance with the same configuration
3. **Bootstrap-Only Configuration** - Dependencies injected once during app startup, then immutable
4. **No Consumer Customization** - Consumers get the service as-is; they don't configure it

**Example: MenuService**
```typescript
// Bootstrap (apps/backend/src/index.ts) - Configure ONCE
MenuService.setDatabase(menuDatabase);
const menuService = MenuService.getInstance();

// Consumer 1 (PagesModule)
await menuService.create({ label: 'Pages' }); // Uses shared state

// Consumer 2 (Plugin)
await menuService.create({ label: 'Plugin' }); // Same shared state

// Consumers CANNOT customize MenuService - they all use the same instance
```

**Utilities are NOT Singletons:**

Utilities/helpers are tools that **each consumer customizes for their own use**:
```typescript
// Each consumer creates their own configured instance
const validator1 = new ValidationHelper({ pattern: /^[a-z]+$/ });
const validator2 = new ValidationHelper({ pattern: /^[0-9]+$/ });

// Different configurations, different behaviors
validator1.validate('abc');  // true
validator2.validate('abc');  // false - different config!
```

Utilities have no `IXxxService` interface because they're not public APIs—they're configurable tools.

**Note:** Both patterns use dependency injection. The key difference is **when and by whom** configuration happens: services are configured once at bootstrap; utilities are configured by each consumer.

### Error Handling in Lifecycle Hooks

**✅ DO:**
- Throw descriptive errors with actionable messages
- Log errors with module metadata context before throwing
- Let errors propagate to bootstrap (causes shutdown)
- Validate all dependencies are provided and non-null

**❌ DON'T:**
- Catch and swallow initialization errors
- Try to continue with missing dependencies
- Use try-catch for error recovery (fail-fast is correct)
- Return boolean success indicators (use exceptions)

**Example:**
```typescript
async init(deps: IMyModuleDependencies): Promise<void> {
    if (!deps.database) {
        throw new Error('Database dependency is required');
    }

    try {
        this.myService = new MyService(deps.database);
    } catch (error) {
        this.logger.error({ error }, 'Failed to create MyService');
        throw new Error(`Service creation failed: ${error.message}`);
    }
}
```

### Testing Requirements

**Every module must have:**
- Metadata validation test
- `init()` phase test verifying no premature activation
- `run()` phase test verifying proper integration
- Lifecycle validation test (run before init throws)
- Dependency injection verification tests
- Error propagation tests for both phases

**Use the pages module test suite as a template** (`apps/backend/src/modules/pages/__tests__/pages.module.test.ts`).

### Documentation Standards

**Every module must have:**
- JSDoc comments on all classes, methods, and interfaces
- Module-level `README.md` explaining architecture and usage
- Inline code comments explaining "why" not "what"
- Public API exports documented in `index.ts`
- Migration guide if replacing existing code

Follow TronRelic's documentation standards from `docs/documentation-guidance.md`:
- Lead with "why" (purpose and risks)
- Follow with "how" (workflow and patterns)
- Close with code examples
- Use plain English and active voice

## Pre-Implementation Checklist

Before creating a new module, verify:

- [ ] Feature is essential infrastructure (cannot be a plugin)
- [ ] Dependencies are clearly identified and typed
- [ ] Module directory structure matches standard pattern
- [ ] `IModule` interface is correctly implemented
- [ ] Metadata includes `id`, `name`, `version`, `description`
- [ ] `init()` creates services but does NOT mount routes or register with other services
- [ ] `run()` mounts routes and completes integration
- [ ] All dependencies use interfaces (`IDatabaseService`) not concrete classes
- [ ] Services use constructor injection for all dependencies
- [ ] Tests cover both lifecycle phases and error handling
- [ ] Public API exports only necessary types via `index.ts`
- [ ] Module-specific `README.md` documents architecture and usage
- [ ] Bootstrap code updated to initialize module in correct sequence
- [ ] JSDoc comments explain "why" before showing "how"

## Further Reading

**Detailed documentation:**
- [pages/README.md](/home/delphian/projects/tronrelic.com-beta/apps/backend/src/modules/pages/README.md) - Complete pages module architecture and patterns
- [system-database-migrations.md](./system-database-migrations.md) - Migration system for schema evolution
- [system-menu.md](./system-menu.md) - Menu service for navigation management
- [system-testing.md](./system-testing.md) - Testing framework with Vitest and Mongoose mocking

**Related topics:**
- [plugins.md](../plugins/plugins.md) - Plugin system overview (comparison to modules)
- [plugins-system-architecture.md](../plugins/plugins-system-architecture.md) - Plugin lifecycle and discovery
- [documentation-guidance.md](../documentation-guidance.md) - Documentation standards and writing conventions
- [environment.md](../environment.md) - Environment variable configuration reference
