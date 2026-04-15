# Creating a Backend Module

Step-by-step guide for building a new TronRelic backend module with the standard directory structure, two-phase lifecycle, and dependency injection patterns.

## Why Follow This Guide

Modules are fail-fast infrastructure — deviations from the standard patterns cause initialization failures, race conditions, or untestable code. This guide codifies the patterns demonstrated by the pages module (`src/backend/modules/pages/`), which serves as the canonical reference implementation. See its [README.md](../../../src/backend/modules/pages/README.md) for complete architecture.

## Directory Structure

```bash
mkdir -p src/backend/src/modules/my-feature/{api,database,services,__tests__}
touch src/backend/src/modules/my-feature/{MyFeatureModule.ts,index.ts,README.md}
```

This creates the standard layout:

```
modules/my-feature/
├── api/              # Controllers and route factories
├── database/         # MongoDB schemas and document interfaces
├── services/         # Business logic layer
├── __tests__/        # Unit and integration tests
├── MyFeatureModule.ts # IModule implementation
├── index.ts          # Public API exports
└── README.md         # Module-specific documentation
```

## Implementation Walkthrough

### 1. Define Dependencies and Implement the Module Class

Define a typed dependencies interface specifying exactly what your module needs, then implement `IModule`. The module class is the central file — it stores dependencies in `init()` and activates in `run()`.

```typescript
import type { Express } from 'express';
import type { IDatabaseService, ICacheService, IModule, IModuleMetadata } from '@/types';

export interface IMyFeatureDependencies {
    database: IDatabaseService;
    cacheService: ICacheService;
    app: Express;
}

export class MyFeatureModule implements IModule<IMyFeatureDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'my-feature',
        name: 'My Feature',
        version: '1.0.0',
        description: 'Brief description of module purpose'
    };

    private database!: IDatabaseService;
    private app!: Express;
    private myService!: MyService;

    async init(deps: IMyFeatureDependencies): Promise<void> {
        this.database = deps.database;
        this.app = deps.app;
        this.myService = new MyService(deps.database, deps.cacheService);
    }

    async run(): Promise<void> {
        const router = Router();
        router.get('/', new MyController(this.myService).getItems.bind(this));
        this.app.use('/api/my-feature', router);
    }
}
```

Key rules: `init()` creates services but does NOT mount routes. `run()` mounts routes and completes integration. Errors thrown from either hook cause application shutdown.

### 2. Create Public API Exports

Export only what external consumers need from `index.ts`:

```typescript
export { MyFeatureModule } from './MyFeatureModule.js';
export type { IMyFeatureDependencies } from './MyFeatureModule.js';
export { MyService } from './services/my.service.js';
```

### 3. Implement Services, Controllers, and Database Schemas

Create services that handle business logic, controllers that handle HTTP request/response, and database interfaces that define your MongoDB document shapes. Collection names must follow the `module_{module-id}_{collection}` convention (see [system-database.md](../system-database.md#namespace-isolation) for details). Follow standard Express and MongoDB patterns — the pages module source files demonstrate all three:

- **Service:** `src/backend/src/modules/pages/services/page.service.ts`
- **Controller:** `src/backend/src/modules/pages/api/pages.controller.ts`
- **Schema:** `src/backend/src/modules/pages/database/IPageDocument.ts`

If your service implements an `IXxxService` interface, it must be a singleton (see [modules.md#service-types-and-singleton-usage](./modules.md#service-types-and-singleton-usage)).

### 4. Register in Bootstrap

Add module initialization to `src/backend/src/index.ts` after MenuService initialization and before plugin loading:

```typescript
import { MyFeatureModule } from './modules/my-feature/index.js';

const myFeatureModule = new MyFeatureModule();
await myFeatureModule.init({ database: coreDatabase, cacheService, app });
await myFeatureModule.run();
```

See [modules-architecture.md](./modules-architecture.md) for the complete bootstrap sequence and where modules fit.

### 5. Write Tests

Every module needs tests covering metadata validation, phase separation (routes NOT mounted during `init()`), lifecycle validation (`run()` before `init()` throws), and dependency injection. Use the pages module test suite as a template: `src/backend/src/modules/pages/__tests__/pages.module.test.ts`. See [system-testing.md](../system-testing.md) for the Mongoose mocking system and test patterns.

### 6. Document the Module

Create `README.md` in the module directory following the pattern in `modules/pages/README.md`: who the document is for, why the module exists, architecture overview, core components, public API exports, and related documentation links. Follow [documentation.md](../../documentation.md) for writing standards.

## Best Practices

### Dependency Injection

Accept dependencies through `init()` parameters and depend on interfaces (`IDatabaseService`), never concrete classes. Never import and instantiate dependencies directly — this prevents mock injection for testing. Store dependencies as private properties for use in `run()`.

### Service Composition

Create services in `init()` and activate them in `run()`. Pass all dependencies to service constructors. Keep services focused on single responsibilities. Use abstract base classes for pluggable infrastructure (storage providers, adapters). The pages module demonstrates this with `PageService` depending on `IStorageProvider` — enabling local, S3, or Cloudflare backends without code changes.

### Error Handling

Throw descriptive errors with actionable messages. Log errors with module metadata context before throwing. Let errors propagate to bootstrap (causes shutdown). Validate all dependencies are provided and non-null. Never catch and swallow initialization errors or try to continue with missing dependencies — fail-fast is correct.

### Testing Requirements

Every module must have: metadata validation test, `init()` phase test verifying no premature activation, `run()` phase test verifying proper integration, lifecycle validation test (`run()` before `init()` throws), dependency injection verification tests, and error propagation tests for both phases.

### Documentation Standards

Every module must have JSDoc comments on all classes, methods, and interfaces, a module-level `README.md`, inline code comments explaining "why" not "what", and public API exports documented in `index.ts`. Follow TronRelic's documentation standards: lead with "why", follow with "how", close with code.

## Pre-Implementation Checklist

- [ ] Feature confirmed as essential infrastructure (not a plugin)
- [ ] Dependencies identified and typed as interfaces
- [ ] Directory structure created with standard layout
- [ ] `IModule` implemented with metadata, `init()`, `run()`
- [ ] `init()` creates services without mounting routes
- [ ] `run()` mounts routes and registers menu items
- [ ] Services with `IXxxService` interfaces use singleton pattern
- [ ] Bootstrap updated in `src/backend/src/index.ts`
- [ ] Tests cover both lifecycle phases and error handling
- [ ] Public API exported via `index.ts`
- [ ] Module `README.md` documents architecture
- [ ] Frontend code (if any) in `src/frontend/modules/<name>/`

## Further Reading

- [modules.md](./modules.md) - Module system overview and decision matrix
- [modules-architecture.md](./modules-architecture.md) - IModule interface, bootstrap sequence, dependency injection
- [Pages Module README](../../../src/backend/modules/pages/README.md) - Pages module (canonical reference implementation)
- [system-testing.md](../system-testing.md) - Testing framework with Vitest and Mongoose mocking
- [frontend-architecture.md](../../frontend/frontend-architecture.md) - Frontend module structure and import patterns
- [documentation.md](../../documentation.md) - Documentation standards and writing conventions
