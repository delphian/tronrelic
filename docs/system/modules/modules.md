# Backend Module System

TronRelic's module system provides a structured pattern for permanent, core backend components that initialize during application bootstrap and remain active for the application's lifetime. Unlike plugins (which can be enabled/disabled at runtime), modules are essential infrastructure the application cannot function without.

## Why This Matters

The module system replaces scattered core code, implicit init order, and concrete-class imports with a two-phase lifecycle (`init()` prepares, `run()` activates), dependency injection via typed interfaces, IoC routing (modules mount their own routes), and colocated file organization where everything for a module lives in `modules/<name>/`.

## Core Architecture

Every module implements the `IModule<TDependencies>` interface from `@/types`, which enforces metadata (`id`, `name`, `version`), an `init(dependencies)` method, and a `run()` method. Both lifecycle hooks are async and fail-fast — errors cause application shutdown with no degraded mode.

Modules initialize after core infrastructure (database, Redis, WebSocket, MenuService) and before plugins, jobs, and the HTTP server. During `init()`, modules store injected dependencies and create services. During `run()`, they mount routes, register menu items, and integrate with the application. This separation ensures all modules prepare themselves before any module interacts with shared services.

Each module declares a typed dependencies interface specifying exactly what it needs (`IDatabaseService`, `ICacheService`, `IMenuService`, `Express`). Modules depend on abstractions, never concrete implementations — enabling mock injection for testing.

See [modules-architecture.md](./modules-architecture.md) for the IModule interface contract, bootstrap sequence, and dependency injection patterns.

## Creating a New Module

New modules follow a standard directory structure with colocated API routes, database schemas, services, and tests. The pages module (`src/backend/modules/pages/`) serves as the canonical reference implementation — see its [README.md](../../../src/backend/modules/pages/README.md) for architecture and patterns.

See [modules-creating.md](./modules-creating.md) for the step-by-step creation guide and best practices.

## Frontend Module Structure

When a module requires frontend code, place it in `src/frontend/modules/<module-name>/` with parallel structure (components, api, lib, types). Module-specific components belong here, not in `components/ui/` (reserved for generic primitives like Button and Badge).

See [frontend-architecture-modules.md](../../frontend/frontend-architecture-modules.md) for frontend module structure, directory layout, import patterns, and the decision guide for where frontend code goes.

## Module vs Plugin Decision Matrix

| Criteria | Module | Plugin |
|----------|--------|--------|
| Essential infrastructure | Yes — app fails without it | No — app works without it |
| Runtime toggle | Cannot disable | Enable/disable via admin UI |
| Bootstrap timing | Initializes before plugins | Loads after modules |
| Provides shared services | Yes (`IXxxService` singletons via constructor DI) | Yes (via `IServiceRegistry` — late-binding, runtime discovery) |
| Deep integration | Express app, core database | Injected `IPluginContext` only |
| Frontend UI | Optional | Typically included |

**Module examples:** Pages, Menu, Identity, Traffic, Scheduler, Logs, Database.

The deciding factor between module and plugin is no longer "does it provide shared services?" but "can the application function without it?" If the answer is no, it's a module. If yes — even if other components optionally consume its services — it's a plugin. The service registry (`context.services`) makes this possible by enabling plugins to expose shared capabilities at runtime without requiring promotion to a module.

See [modules-architecture.md](./modules-architecture.md#service-registry--late-binding-di) for how the registry complements constructor injection, and [plugins-service-registry.md](../../plugins/plugins-service-registry.md) for registration and consumption patterns.

When migrating between the two, see [modules-architecture.md](./modules-architecture.md#migration-considerations) for step-by-step guidance.

## Core-Pipeline Hooks

Modules can also participate in the typed hook registry as `'core'` — the same mechanism plugins use to contribute at declared seams. A module receives `IHookRegistry` through its `init(deps)` interface and registers handlers in `run()` after dependencies are wired, calling `hookRegistry.register('core', HOOKS.<phase>.<name>, handler, { priority })`. Module registrations live for the process lifetime (no disable/uninstall), so the disposer returned by `register` is typically stored only for symmetry with the plugin facade pattern. No core module ships a hook registration today — the canonical example is the `trp-themes` plugin contributing to `HOOKS.ssr.headFragments` and `HOOKS.ssr.htmlAttributes` via the plugin facade, which exercises the same registry through `context.hooks.register(...)`. See [system-hooks.md](../system-hooks.md) for the contract, the four archetypes (observer / series / waterfall / bail), and the `/system/hooks` admin timeline that introspects registrations.

## Service Types and Singleton Usage

Services implementing `IXxxService` interfaces (e.g., `IPageService`, `IMenuService`) **must be singletons**. They are public APIs with shared single state, configured once at bootstrap via dependency injection, and consumed as-is by all callers.

| Pattern | What Is It? | Singleton? | Customizable? |
|---------|-------------|------------|---------------|
| **Service** (`IXxxService`) | Public API with shared state | Yes | No — configured once at bootstrap |
| **Utility** (no interface) | Tool for consumer's own use | No | Yes — each consumer configures their own |

The key difference is when and by whom configuration happens. Services are configured once during bootstrap; utilities are configured by each consumer. `ISystemLogService` appears to break this rule with its `child()` method, but `child()` creates scoped views of the same logging system — not true per-consumer customization.

See [modules-architecture.md](./modules-architecture.md#service-types-and-singleton-usage) for implementation examples.

## Pre-Implementation Checklist

Before creating a new module, confirm the feature is essential infrastructure (otherwise build it as a plugin) and follow [modules-creating.md](./modules-creating.md) for the standard directory structure, lifecycle hook split (init creates services, run mounts routes), and tests covering both phases.

## Further Reading

**Module system details:**
- [modules-architecture.md](./modules-architecture.md) - IModule interface, bootstrap sequence, dependency injection, service types, module vs plugin migration
- [modules-creating.md](./modules-creating.md) - Step-by-step creation guide with best practices

**Example modules** (each has a README.md in its directory with complete documentation):
- [Pages](../../../src/backend/modules/pages/) - Canonical reference implementation (storage providers, file uploads, markdown CMS)
- [Menu](../../../src/backend/modules/menu/) - Navigation management, event-driven validation, WebSocket updates
- [Identity](../../../src/backend/modules/identity/) - Better Auth, groups, signature-proven wallet store, account directory
- [Traffic](../../../src/backend/modules/traffic/) - ClickHouse traffic_events analytics, tid/ref cookies, bot/geo classification

**Related topics:**
- [system-database.md](../system-database.md) - Database access architecture and IDatabaseService
- [system-database-migrations.md](../system-database-migrations.md) - Migration system for schema evolution
- [system-hooks.md](../system-hooks.md) - Core-pipeline hooks: declared seams, archetypes, admin introspection
- [system-testing.md](../system-testing.md) - Testing framework with Vitest and Mongoose mocking
- [plugins.md](../../plugins/plugins.md) - Plugin system overview (comparison to modules)
- [frontend-architecture.md](../../frontend/frontend-architecture.md) - Frontend module structure and import patterns
