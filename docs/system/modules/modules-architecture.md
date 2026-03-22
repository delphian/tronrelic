# Module System Architecture

Technical reference for TronRelic's `IModule` interface contract, application bootstrap sequence, dependency injection patterns, service type rules, and migration guidance between modules and plugins.

## Why This Matters

Modules are fail-fast infrastructure — an initialization error shuts down the application. Understanding the interface contract, bootstrap ordering, and dependency injection rules prevents runtime failures, race conditions, and untestable code. The service type rules (singleton vs utility) prevent shared state bugs that surface only in production when multiple consumers interact with the same service.

## IModule Interface Contract

All modules implement `IModule<TDependencies>` from `@tronrelic/types` (see `packages/types/src/module/IModule.ts`):

```typescript
interface IModule<TDependencies extends Record<string, any> = Record<string, any>> {
    readonly metadata: IModuleMetadata;
    init(dependencies: TDependencies): Promise<void>;
    run(): Promise<void>;
}
```

The generic `TDependencies` parameter lets each module declare exactly what it needs. Both `init()` and `run()` are async — they can perform database operations, file I/O, or service initialization. Errors thrown from either hook cause application shutdown (no degraded mode).

`IModuleMetadata` requires `id` (lowercase kebab-case matching the directory name), `name` (human-readable), `version` (semver), and an optional `description`. Declare metadata as a `readonly` property set during construction.

## Bootstrap Sequence

The application bootstrap (`src/backend/src/index.ts`) follows a strict ordering that guarantees dependency availability:

1. Database and Redis connections
2. Logger initialization
3. System config, migration system, blockchain observer service
4. Express app and HTTP server creation
5. WebSocket initialization
6. MenuService initialization
7. **Module `init()` phase** — prepare resources, create services
8. **Module `run()` phase** — mount routes, register menu items
9. Plugin loading
10. Job scheduler initialization
11. Server starts listening

This sequence guarantees modules can safely use MenuService, WebSocketService, and other core infrastructure during `run()`. The two-phase split ensures all modules finish preparing before any module begins interacting with shared services.

## Dependency Injection Pattern

Each module defines a typed dependencies interface:

```typescript
export interface IMyModuleDependencies {
    database: IDatabaseService;
    cacheService: ICacheService;
    menuService: IMenuService;
    app: Express;
}
```

The bootstrap constructs these dependencies and injects them during `init()`. Modules store them as private properties for use in `run()`. Modules depend on interfaces (`IDatabaseService`), never concrete implementations — enabling mock injection for testing.

Never import and instantiate dependencies directly, use global singletons (except logger), or access dependencies before `init()` completes. Never assume other modules are initialized during `init()` — only `run()` guarantees all modules are ready.

## Service Types and Singleton Usage

Services implementing `IXxxService` interfaces are public APIs with shared single state. All consumers use the same instance configured once at bootstrap. Utilities (no `IXxxService` interface) are tools each consumer configures independently.

**Singleton service pattern:**

```typescript
export class PageService implements IPageService {
    private static instance: PageService;

    private constructor(
        private readonly database: IDatabaseService,
        private readonly storageProvider: IStorageProvider
    ) { }

    public static setDependencies(database: IDatabaseService, provider: IStorageProvider): void {
        if (!PageService.instance) {
            PageService.instance = new PageService(database, provider);
        }
    }

    public static getInstance(): PageService {
        if (!PageService.instance) throw new Error('setDependencies() must be called first');
        return PageService.instance;
    }
}
```

**Utility pattern (not a singleton):**

```typescript
export class ValidationHelper {
    constructor(private readonly config: ValidationConfig) { }
    validate(input: string): boolean { return this.config.pattern.test(input); }
}
// Each consumer creates their own: new ValidationHelper({ pattern: /^[a-z]+$/ })
```

Services must be singletons because they expose functionality to external consumers (modules, plugins), maintain shared state, and are configured immutably at bootstrap. Utilities have no `IXxxService` interface because each consumer customizes them independently.

`ISystemLogService` appears to break this rule with its `child()` method, but `child()` creates scoped views of the same underlying logging system — not true per-consumer customization.

## Migration Considerations

**Plugin to Module:** Create module directory structure, implement `IModule`, define typed dependencies, move business logic to services layer, remove plugin lifecycle hooks (replace with `init()`/`run()`), update bootstrap to initialize before plugins, update documentation.

**Module to Plugin:** Create plugin manifest with `backend` flag, implement plugin lifecycle hooks (`init`, `enable`, `disable`, `uninstall`), replace typed dependencies with `IPluginContext`, move menu registration to plugin `enable()` hook, add database migration for state tracking, remove module from bootstrap.

See [plugins.md](../../plugins/plugins.md) for complete plugin lifecycle documentation.

## Further Reading

- [modules.md](./modules.md) - Module system overview and decision matrix
- [modules-creating.md](./modules-creating.md) - Step-by-step module creation guide
- [Pages Module README](../../../src/backend/modules/pages/README.md) - Pages module as canonical reference implementation
- [system-database.md](../system-database.md) - Database access architecture and IDatabaseService
- [system-testing.md](../system-testing.md) - Testing framework with mock patterns
- [plugins.md](../../plugins/plugins.md) - Plugin system overview (comparison to modules)
