# Database Access Architecture

All database operations in TronRelic must go through `IDatabaseService`. This unified abstraction layer provides testability, consistent patterns, and automatic namespace isolation. Direct imports of Mongoose models or raw MongoDB collections are prohibited.

## Why This Matters

All database access flows through `IDatabaseService` to enforce testability, plugin namespace isolation, and consistent query patterns. Direct Mongoose imports bypass these guarantees — making services untestable, exposing plugins to cross-collection conflicts, and scattering connection logic across the codebase.

## Mandatory Requirement

**All database access must flow through `IDatabaseService`.** This applies to:

| Consumer Type | How They Receive It | Collection Prefixing |
|---------------|---------------------|----------------------|
| **Modules** | Dependency injection via `init()` | None (core collections) |
| **Services** | Constructor injection | None (core collections) |
| **Plugins** | `context.database` in lifecycle hooks | Automatic (`plugin_<id>_`) |

**Prohibited patterns:**

```typescript
// WRONG - Direct Mongoose import
import mongoose from 'mongoose';
const collection = mongoose.connection.collection('alerts');

// WRONG - Direct model import
import { TransactionModel } from '../models/Transaction';
const txs = await TransactionModel.find({});

// WRONG - Creating own DatabaseService instance
const db = new DatabaseService(logger, mongoose.connection);
```

**Correct pattern:**

```typescript
// CORRECT - Receive via dependency injection
class MyService {
    constructor(private readonly database: IDatabaseService) {}

    async getAlerts() {
        return this.database.find('alerts', { dismissed: false });
    }
}
```

## How Database Access Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     IDatabaseService                         │
│                    (interface contract)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     DatabaseService                          │
│              (core implementation, no prefix)                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Three-Tier Access Pattern:                           │   │
│  │  Tier 1: Raw Collections (getCollection)             │   │
│  │  Tier 2: Mongoose Model Registry (registerModel)     │   │
│  │  Tier 3: Convenience Methods (find, insertOne, etc)  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  PluginDatabaseService                       │
│           (extends DatabaseService, adds prefix)             │
│                                                             │
│  Collection "alerts" → "plugin_whale-alerts_alerts"         │
└─────────────────────────────────────────────────────────────┘
```

### Three-Tier Access Pattern

The database service provides three levels of abstraction:

**Tier 1 - Raw Collections:** Direct MongoDB native driver access for maximum flexibility. Use for complex aggregations, bulk operations, or when convenience methods are insufficient.

```typescript
const collection = database.getCollection<TransactionDoc>('transactions');
const cursor = collection.aggregate([
    { $match: { blockNumber: { $gte: 1000 } } },
    { $group: { _id: '$type', count: { $sum: 1 } } }
]);
```

**Tier 2 - Mongoose Model Registry:** Optional registration of Mongoose models to preserve schema validation, defaults, hooks, and virtuals. When registered, convenience methods automatically use the model.

```typescript
// In service constructor - register model once
database.registerModel('system_config', SystemConfigModel);

// Later queries use Mongoose automatically
const config = await database.findOne('system_config', { key: 'system' });
// ^ Uses SystemConfigModel.findOne() with validation
```

**Tier 3 - Convenience Methods:** Smart helpers that prefer Mongoose models when available, falling back to raw collection access. Reduces boilerplate for standard CRUD.

```typescript
// These methods check the model registry first
await database.find('alerts', { dismissed: false }, { limit: 100 });
await database.insertOne('alerts', { userId: '123', type: 'whale' });
await database.updateMany('alerts', { old: true }, { $set: { dismissed: true } });
await database.deleteMany('logs', { timestamp: { $lt: cutoffDate } });
```

### Key-Value Storage

For simple configuration and state, the database service provides key-value storage backed by a `_kv` collection:

```typescript
// Store configuration
await database.set('lastSyncTime', new Date());
await database.set('config', { threshold: 1000, enabled: true });

// Retrieve configuration
const lastSync = await database.get<Date>('lastSyncTime');
const config = await database.get<{ threshold: number }>('config');

// Delete key
await database.delete('tempCache');
```

## Consumer-Specific Patterns

### Modules

Modules receive `IDatabaseService` through dependency injection during their `init()` phase. Unlike plugins (which get automatic prefixing via `PluginDatabaseService`), modules must manually prefix collection names following the `module_{module-id}_{collection}` convention. This makes collection ownership obvious when inspecting the database and mirrors the plugin prefixing pattern.

```typescript
export interface IMyModuleDependencies {
    database: IDatabaseService;
    // other dependencies...
}

export class MyModule implements IModule<IMyModuleDependencies> {
    private database!: IDatabaseService;

    async init(deps: IMyModuleDependencies): Promise<void> {
        this.database = deps.database;

        // Collection name follows module_{module-id}_{collection} convention
        this.database.registerModel('module_my-feature_items', MyModel);
    }

    async run(): Promise<void> {
        // Use database in services created during run()
    }
}
```

**See [modules.md](./modules/modules.md) for complete module architecture.**

### Services

Services receive `IDatabaseService` via constructor injection. Services implementing `IXxxService` interfaces must be singletons:

```typescript
export class PageService implements IPageService {
    private static instance: PageService;
    private readonly pagesCollection: Collection<IPageDocument>;

    private constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {
        // Get typed collections in constructor
        this.pagesCollection = database.getCollection<IPageDocument>('pages');

        // Register model for Mongoose benefits
        database.registerModel('pages', PageModel);
    }

    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!PageService.instance) {
            PageService.instance = new PageService(database, logger);
        }
    }

    public static getInstance(): PageService {
        if (!PageService.instance) {
            throw new Error('setDependencies() must be called first');
        }
        return PageService.instance;
    }

    async getPageBySlug(slug: string): Promise<IPage | null> {
        return this.database.findOne('pages', { slug, published: true });
    }
}
```

**See [modules.md#service-types-and-singleton-usage](./modules/modules.md#service-types-and-singleton-usage) for singleton patterns.**

### Plugins

Plugins receive an isolated `IDatabaseService` instance via `context.database` in lifecycle hooks. Collection names are automatically prefixed with `plugin_<id>_`:

```typescript
export const whaleAlertsPlugin = definePlugin({
    manifest: whaleAlertsManifest,

    install: async ({ database }) => {
        // Creates index on "plugin_whale-alerts_subscriptions"
        await database.createIndex('subscriptions', { userId: 1 }, { unique: true });
        await database.set('config', { enabled: true, threshold: 500_000 });
    },

    init: async ({ database, observerRegistry }) => {
        // Reads from "plugin_whale-alerts__kv"
        const config = await database.get<{ enabled: boolean }>('config');
        if (!config?.enabled) return;

        // Queries "plugin_whale-alerts_subscriptions"
        const subs = await database.find('subscriptions', { active: true });
    }
});
```

**Important:** The `IPluginDatabase` type is deprecated. Use `IDatabaseService` directly:

```typescript
// Old (still works but deprecated)
import type { IPluginDatabase } from '@/types';

// New (preferred)
import type { IDatabaseService } from '@/types';
```

#### Plugin Lifecycle Database Usage

Each plugin lifecycle hook has specific database responsibilities:

| Hook | When It Runs | Database Tasks |
|------|--------------|----------------|
| `install` | First introduction or upgrade | Create indexes, seed defaults, record version markers |
| `init` | Every application boot | Load config via `get()`, hydrate observers, wire up jobs |
| `uninstall` | Plugin removal | Optionally drop collections or clear key-value entries |

**Example with full lifecycle:**

```typescript
export const delegationTrackerPlugin = definePlugin({
    manifest: delegationTrackerManifest,

    install: async ({ database }) => {
        // Create indexes before plugin goes live
        await database.createIndex('flows', { fromAddress: 1, timestamp: -1 });
        await database.createIndex('flows', { toAddress: 1, timestamp: -1 });

        // TTL index for automatic cleanup
        await database.createIndex('flows', { timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

        // Seed default configuration
        await database.set('config', { enabled: true, minAmount: 1_000_000 });
    },

    init: async ({ database, observerRegistry, websocketService }) => {
        const config = await database.get<{ enabled: boolean; minAmount: number }>('config');
        if (!config?.enabled) return;

        const observer = createDelegationObserver(database, websocketService, config.minAmount);
        observerRegistry.subscribeTransactionType('FreezeBalanceV2Contract', observer);
    },

    uninstall: async ({ database }) => {
        // Optional: clean up plugin data
        await database.deleteMany('flows', {});
        await database.delete('config');
    }
});
```

#### Plugin Database Good Practices

- **Model data deliberately** - Keep documents small, add indexes only for queries you actually run, batch writes when possible
- **Handle missing configuration gracefully** - Treat `database.get('config')` returning `undefined` as a cue to run installer logic or disable the feature
- **Prefer convenience methods** - Use `find()`, `insertOne()`, etc. instead of `getCollection()` unless you need aggregations or bulk operations
- **Document your schema** - Add a short README in the plugin directory describing stored collections and keys

**See [plugins-system-architecture.md](../plugins/plugins-system-architecture.md) for complete plugin lifecycle documentation.**

## Namespace Isolation

Both modules and plugins use prefixed collection names to make ownership visible when inspecting the database. Plugins get automatic prefixing via `PluginDatabaseService`; modules apply the prefix manually.

| Consumer | Logical Name | Physical Collection Name |
|----------|--------------|--------------------------|
| Module (user) | `gsc_queries` | `module_user_gsc_queries` |
| Module (user, legacy) | `users` | `users` (legacy, unprefixed) |
| Plugin (whale-alerts) | `subscriptions` | `plugin_whale-alerts_subscriptions` |
| Plugin (whale-alerts) | `_kv` | `plugin_whale-alerts__kv` |
| Plugin (telegram-bot) | `subscriptions` | `plugin_telegram-bot_subscriptions` |

**Naming conventions:**

- **Modules:** `module_{module-id}_{collection}` — applied manually when calling `getCollection()` or `registerModel()`
- **Plugins:** `plugin_{plugin-id}_{collection}` — applied automatically by `PluginDatabaseService`
- **Legacy collections** (`users`, `pages`, `menu_nodes`, `themes`) predate this convention and will be migrated over time

**Isolation guarantees:**

- Plugins cannot access collections outside their prefix
- Two plugins using the same logical collection name (`subscriptions`) get separate physical collections
- Attempting cross-prefix access from a plugin throws an error

```typescript
// In whale-alerts plugin context
await database.getCollection('subscriptions'); // OK → plugin_whale-alerts_subscriptions
await database.getCollection('system_config'); // ERROR - cannot access non-prefixed collection

// In user module (manual prefixing)
const collection = database.getCollection('module_user_gsc_queries');
```

## Quick Reference

### Available Methods

| Method | Purpose | Mongoose-Aware |
|--------|---------|----------------|
| `getCollection(name)` | Raw MongoDB collection access | No |
| `registerModel(name, model)` | Register Mongoose model | N/A |
| `getModel(name)` | Retrieve registered model | N/A |
| `find(name, filter, options)` | Query multiple documents | Yes |
| `findOne(name, filter)` | Query single document | Yes |
| `insertOne(name, doc)` | Insert document | Yes |
| `updateMany(name, filter, update)` | Update documents | Yes |
| `deleteMany(name, filter)` | Delete documents | Yes |
| `count(name, filter)` | Count documents | Yes |
| `createIndex(name, spec, options)` | Create collection index | No |
| `get(key)` | Get key-value | No |
| `set(key, value)` | Set key-value | No |
| `delete(key)` | Delete key-value | No |

### Index Creation

Create indexes during module `init()` or plugin `install()`:

```typescript
// Single field index
await database.createIndex('transactions', { txId: 1 }, { unique: true });

// Compound index
await database.createIndex('transactions', { blockNumber: 1, timestamp: -1 });

// TTL index (auto-delete after 30 days)
await database.createIndex('logs', { timestamp: 1 }, { expireAfterSeconds: 2592000 });

// Sparse index (only index documents with the field)
await database.createIndex('users', { email: 1 }, { unique: true, sparse: true });
```

### Error Handling

```typescript
try {
    await database.insertOne('transactions', { txId: 'abc123', ...data });
} catch (error) {
    if (error.code === 11000) {
        // Duplicate key - document already exists
        logger.warn({ txId: 'abc123' }, 'Transaction already indexed');
    } else {
        throw error;
    }
}
```

## Pre-Implementation Checklist

Before writing database access code, verify:

- [ ] Consumer receives `IDatabaseService` via injection (not direct import)
- [ ] No direct imports of Mongoose or MongoDB driver
- [ ] No instantiation of `DatabaseService` (except in bootstrap)
- [ ] Collection names follow `module_{module-id}_{collection}` convention (modules) or are auto-prefixed (plugins)
- [ ] Mongoose models registered in constructor/init if validation needed
- [ ] Indexes created during initialization (module `init()` or plugin `install()`)
- [ ] Error handling covers duplicate key errors (code 11000)
- [ ] Unit tests use mock `IDatabaseService` implementation

## Further Reading

**Detailed documentation:**
- [modules.md](./modules/modules.md) - Module architecture and dependency injection patterns
- [system-database-migrations.md](./system-database-migrations.md) - Database migration system for schema evolution
- [system-testing.md](./system-testing.md) - Testing with mock database implementations

**Plugin-specific:**
- [plugins-system-architecture.md](../plugins/plugins-system-architecture.md) - Plugin lifecycle and context injection
- [plugins.md](../plugins/plugins.md) - Plugin system overview and package layout

**Interface reference:**
- `packages/types/src/database/IDatabaseService.ts` - Complete interface documentation with JSDoc
- `src/backend/src/modules/database/services/database.service.ts` - Implementation details
