# Backend Module System

A module is a permanent, core backend component that starts up with the application and stays active for its whole lifetime. Modules are the infrastructure the application cannot run without, which is what separates them from plugins — plugins can be switched on and off at runtime.

## Why This Matters

Before the module system, core functionality was scattered, startup order was implicit and easy to break, and components imported each other's concrete classes directly. The module system addresses each of those problems. Startup happens in two explicit phases, where `init()` prepares a module and `run()` activates it. Components receive their collaborators through typed interfaces rather than constructing them. Each module mounts its own routes instead of a central file knowing about every route in the application. And everything belonging to a module lives together in `modules/<name>/`.

## Core Architecture

Every module implements the `IModule<TDependencies>` interface from `@/types`. The interface requires metadata (`id`, `name`, `version`), an `init(dependencies)` method, and a `run()` method. Both methods are asynchronous, and if either one throws, the application stops rather than starting without that module.

Modules start after the core infrastructure they rely on — database, Redis, WebSocket server, and the menu service — and before plugins, scheduled jobs, and the HTTP server. In `init()`, a module stores the dependencies it was handed and creates its services. In `run()`, it mounts its routes, registers its menu entries, and connects itself to the rest of the application. Splitting the two guarantees that every module has finished preparing itself before any module starts using another module's services.

Each module declares an interface listing exactly the dependencies it needs, such as `IDatabaseService`, `ICacheService`, `IMenuService`, or the `Express` application. Those dependencies are passed in rather than created internally, a pattern known as dependency injection. Because every declared dependency is an interface rather than a concrete class, tests can supply mock implementations.

See [modules-architecture.md](./modules-architecture.md) for the full `IModule` contract, the startup sequence, and the dependency injection patterns.

## Creating a New Module

New modules follow a standard directory layout that keeps API routes, database schemas, services, and tests together. The pages module at `src/backend/modules/pages/` is the reference implementation; its [README.md](../../../src/backend/modules/pages/README.md) documents the architecture and patterns to copy.

See [modules-creating.md](./modules-creating.md) for the step-by-step guide.

## Frontend Module Structure

When a module needs frontend code, put it in `src/frontend/modules/<module-name>/`, mirroring the backend layout with directories for components, api, lib, and types. Components specific to a module belong there rather than in `components/ui/`, which is reserved for generic building blocks such as `Button` and `Badge`.

See [frontend-architecture-modules.md](../../frontend/frontend-architecture-modules.md) for the directory layout, import conventions, and guidance on deciding where a piece of frontend code belongs.

## Surfacing a Module's Schedules and Storage

A module that registers a scheduler job or owns a collection must surface each of those on its own admin page, as a Schedules tab, a Database tab, or both, so an operator diagnosing the module does not have to leave for `/system/scheduler` or `/system/database` and find its rows among every other component's. Build the tabs from the core `SchedulerMonitor`, `CollectionBrowser`, and `ClickHouseTableBrowser` components, scoped to the module by job-name prefix and by the `module_<id>_` collection prefix, rather than writing a panel for the page.

`/system/address-tags` is the reference implementation. The full rule, including the props each component scopes on, is in [frontend.md](../../frontend/frontend.md#a-component-that-owns-schedules-or-storage-surfaces-them).

## Choosing Between a Module and a Plugin

| Criteria | Module | Plugin |
|----------|--------|--------|
| Essential infrastructure | Yes — the app fails without it | No — the app works without it |
| Runtime toggle | Cannot be disabled | Enabled and disabled from the admin interface |
| Startup timing | Starts before plugins | Loads after modules |
| Provides shared services | Yes, as `IXxxService` singletons passed in at construction | Yes, through `IServiceRegistry`, discovered at runtime |
| Depth of integration | Reaches the Express app and the core database | Only what the injected `IPluginContext` exposes |
| Frontend UI | Optional | Usually included |

**Existing modules:** Pages, Menu, Identity, Traffic, Scheduler, Logs, Database.

Decide by asking whether the application can function without the feature, rather than by asking whether it provides shared services. If the application cannot function without it, build a module. If it can, build a plugin, even when other components will consume its services. The service registry (`context.services`) is what makes that possible: a plugin can offer a shared capability at runtime without being promoted to a module.

See [modules-architecture.md](./modules-architecture.md#service-registry--late-binding-di) for how the registry complements dependencies passed in at construction, and [plugins-service-registry.md](../../plugins/plugins-service-registry.md) for how to register and consume services. For moving an existing component from one category to the other, see [modules-architecture.md](./modules-architecture.md#migration-considerations).

## Contributing to Core-Pipeline Hooks

A hook seam is a named point in core's own execution where other code can contribute behaviour, such as adding markup to the HTML `<head>` during server-side rendering. Modules can register at these seams under the identity `'core'`, using the same registry plugins use.

A module receives `IHookRegistry` through the dependencies passed to `init(deps)` and registers its handlers in `run()`, once everything is wired, by calling `hookRegistry.register('core', HOOKS.<phase>.<name>, handler, { priority })`. A module's registrations last for the life of the process, since a module can never be disabled or uninstalled, so the disposer function that `register` returns is usually kept only for consistency with how plugins do it.

The `ai-tools` module is the one core module registering a hook today: it registers a result compactor on `HOOKS.ai.toolResult` under the `'core'` id, to shrink an oversized tool result before it reaches the model. On the plugin side the working example is `trp-themes`, which contributes to `HOOKS.ssr.headFragments` and `HOOKS.ssr.htmlAttributes` through the plugin-facing wrapper by calling `context.hooks.register(...)` against the same registry.

See [system-hooks.md](../system-hooks.md) for the contract, the four styles of hook (observer, series, waterfall, and bail), and the `/system/hooks` timeline that shows what is currently registered.

## Which Components Must Be Singletons

Anything implementing an `IXxxService` interface, such as `IPageService` or `IMenuService`, **must be a singleton** — one shared instance for the whole application. A service is a public API over state that the whole application shares. It is configured once during startup through dependency injection, and every caller uses it exactly as configured. A utility has no `IXxxService` interface and does not have to be a singleton.

| Pattern | What it is | Singleton? | Customizable? |
|---------|------------|------------|---------------|
| **Service** (`IXxxService`) | Public API over shared state | Yes | No — configured once at startup |
| **Utility** (no interface) | A tool the consumer configures for its own use | No | Yes — each consumer configures its own |

The difference is when configuration happens and who does it. The application configures a service once at startup. A utility is configured by whatever code uses it. `ISystemLogService` looks like an exception because of its `child()` method, but `child()` returns a scoped view of the same logging system rather than a separately configured copy.

See [modules-architecture.md](./modules-architecture.md#service-types-and-singleton-usage) for implementation examples.

## Before You Start

Confirm the feature really is essential infrastructure; if the application would still work without it, build it as a plugin instead. Then follow [modules-creating.md](./modules-creating.md) for the standard directory structure, the split between the two lifecycle phases (`init()` creates services, `run()` mounts routes), and tests that cover both.

## Further Reading

**Module system details:**
- [modules-architecture.md](./modules-architecture.md) — the `IModule` interface, startup sequence, dependency injection, service types, and moving between module and plugin
- [modules-creating.md](./modules-creating.md) — step-by-step creation guide

**Example modules** (each directory holds a README.md with complete documentation):
- [Pages](../../../src/backend/modules/pages/) — the reference implementation, covering storage providers, file uploads, and the markdown content management system
- [Menu](../../../src/backend/modules/menu/) — navigation entries, event-driven validation, and WebSocket updates
- [Identity](../../../src/backend/modules/identity/) — Better Auth, user groups, wallets proven by signature, and the account directory
- [Traffic](../../../src/backend/modules/traffic/) — ClickHouse `traffic_events` analytics, the tid and ref cookies, and bot and geography classification

**Related topics:**
- [system-database.md](../system-database.md) — database access architecture and `IDatabaseService`
- [system-database-migrations.md](../system-database-migrations.md) — how schema changes are applied
- [system-hooks.md](../system-hooks.md) — hook seams, the four styles, and admin introspection
- [system-testing.md](../system-testing.md) — testing with Vitest and Mongoose mocks
- [plugins.md](../../plugins/plugins.md) — the plugin system, for comparison
- [frontend-architecture.md](../../frontend/frontend-architecture.md) — frontend module structure and import patterns
