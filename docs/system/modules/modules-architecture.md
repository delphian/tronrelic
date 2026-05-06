# Module System Architecture

Technical reference for TronRelic's `IModule` interface contract, application bootstrap sequence, dependency injection patterns, service type rules, and migration guidance between modules and plugins.

## Why This Matters

Modules are fail-fast infrastructure — an initialization error shuts down the application. Understanding the interface contract, bootstrap ordering, and dependency injection rules prevents runtime failures, race conditions, and untestable code. The service type rules (singleton vs utility) prevent shared state bugs that surface only in production when multiple consumers interact with the same service.

## IModule Interface Contract

All modules implement `IModule<TDependencies>` from `@/types` (see `packages/types/src/module/IModule.ts`):

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

The application bootstrap (`src/backend/index.ts`) splits into `bootstrapInit()` and `bootstrapRun()`. Every module finishes `init()` before any module starts `run()`, and plugins load after both phases.

**`bootstrapInit()`** — in this order:

1. `connectDatabase()` (Mongo)
2. Redis connect
3. Pino logger
4. Express app + HTTP server
5. `WebSocketService.initialize(server)` (gated by `ENABLE_WEBSOCKETS`)
6. **`DatabaseModule.init()`** — first because everything else depends on it
7. **`ClickHouseModule.init()`** — optional; skipped without `CLICKHOUSE_HOST`
8. Mount `/api` router
9. `initializeCoreServices(coreDatabase)` — system config, migrations, blockchain observer service
10. `new ServiceRegistry(logger)` — registry constructed *before* MenuModule so MenuService can publish itself for late-binding consumers during `run()`
11. `serviceRegistry.register('chain-parameters', ChainParametersService.getInstance())`
12. **`MenuModule.init()`**
13. `new CacheService(redis, coreDatabase)` and assemble `sharedDeps`
14. **Remaining module inits in this order:** Logs, Pages, Theme, Scheduler, User, AddressLabels, Tools (User receives `scheduler`, `systemConfig`, and `clickhouse` on top of `sharedDeps`)

**`bootstrapRun()`** — in this order:

Database, ClickHouse, Menu, Logs, Pages, Theme, User, AddressLabels, Tools, **Scheduler last** (so it doesn't tick before its peers are integrated).

After `bootstrapRun()`, `loadPlugins(coreDatabase, scheduler, serviceRegistry)` runs and the HTTP server starts listening. The two-phase split lets modules safely use MenuService, WebSocketService, ChainParametersService, and the service registry during `run()`. The order above is the source of truth — see the `bootstrapInit` and `bootstrapRun` calls in `src/backend/index.ts`.

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

### Service Registry — Late-Binding DI

Constructor injection handles static, known-at-bootstrap dependencies. The service registry (`IServiceRegistry`) handles dynamic, runtime-discovered services — primarily those provided by plugins.

Both mechanisms enforce the same DI principle: consumers depend on abstractions, never concrete implementations. Constructor injection resolves statically at bootstrap (the bootstrap file wires the concrete instance). The registry resolves dynamically at call time (the consumer asks for a name and gets whatever was registered). The contract is still interface-based either way.

Modules continue using constructor injection for core infrastructure — database, cache, menu service. The registry complements this by giving modules access to optional, plugin-provided services they couldn't receive at bootstrap because plugins load after modules. A module that wants to use an AI service provided by a plugin would look it up via the registry during request handling, not at initialization time.

```typescript
// Module uses constructor DI for core infrastructure
async init(deps: IMyModuleDependencies): Promise<void> {
    this.database = deps.database;  // Static, always available
}

// Module uses registry for optional plugin-provided services
async handleRequest(req: Request, res: Response): Promise<void> {
    const ai = this.serviceRegistry.get<IAiAssistantService>('ai-assistant');
    if (ai) {
        // Plugin service available — use it
    }
    // Plugin service unavailable — proceed without it
}
```

The registry does not replace constructor injection. Modules keep their typed dependency interfaces for everything that must be present at bootstrap. The registry adds the ability to discover services that may or may not exist depending on which plugins are enabled. See [plugins-service-registry.md](../../plugins/plugins-service-registry.md) for the plugin-side registration pattern.

The registry exposes two lookup shapes, and the choice between them is about consumer lifetime, not provider identity. Use `get()` for one-shot reads — a request handler, a scheduled tick, a diagnostic sweep — where the caller needs the service now and doesn't care whether it appears or disappears afterward. Use `watch()` when the caller's behavior depends on the service being present over time, such as registering peer-facing hooks the moment a provider appears or dropping cached references when it goes away. `watch()` fires synchronously on subscription if the service is already present, re-fires on every subsequent re-registration, and fires an `onUnavailable` handler on every unregistration — closing both the boot-order race (consumer inits before provider) and the runtime-churn case (operator disables and re-enables a plugin). Module-provided services don't unregister at runtime, so modules consuming other modules rarely need `watch()`; plugin-provided services are the common case where `watch()` pays for itself. See [plugins-service-registry.md](../../plugins/plugins-service-registry.md) for the handler rules and consumer patterns.

## Service Types and Singleton Usage

Services implementing `IXxxService` interfaces are public APIs with shared single state — one instance configured once at bootstrap, consumed by all callers. They follow the `setDependencies(...)` / `getInstance()` pattern (see `PageService` in `src/backend/modules/pages/services/`); the first call wires concrete dependencies, every subsequent call returns the same instance, and `getInstance()` before `setDependencies()` throws.

Utilities — small helpers without an `IXxxService` interface — are not singletons. Each consumer constructs and configures their own, e.g. `new ValidationHelper({ pattern: /^[a-z]+$/ })`. The distinction is *who configures it and when*: services at bootstrap, utilities at the call site.

`ISystemLogService` appears to break the rule with `child()`, but `child()` returns a scoped *view* of the same underlying logging system — not a per-consumer customized service.

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
