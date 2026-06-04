# Database Access Architecture

All database operations in TronRelic flow through `IDatabaseService`. Direct imports of Mongoose models or raw MongoDB collections are prohibited.

## Why This Matters

`IDatabaseService` enforces testability (mock injection), plugin namespace isolation, and consistent query patterns. Direct Mongoose imports bypass these guarantees — making services untestable, exposing plugins to cross-collection conflicts, and scattering connection logic across the codebase.

**Prohibited:**

```typescript
import mongoose from 'mongoose';
const collection = mongoose.connection.collection('alerts'); // WRONG

import { TransactionModel } from '../models/Transaction';
const txs = await TransactionModel.find({}); // WRONG

const db = new DatabaseService(logger, mongoose.connection); // WRONG
```

**Correct — receive via DI:**

```typescript
class MyService {
    constructor(private readonly database: IDatabaseService) {}
    async getAlerts() {
        return this.database.find('alerts', { dismissed: false });
    }
}
```

| Consumer | How they receive it | Collection prefixing |
|---|---|---|
| Modules | `init(deps)` dependency injection | None — manual `module_{id}_*` convention |
| Services | Constructor injection | None — uses caller's prefix policy |
| Plugins | `context.database` in lifecycle hooks | Automatic `plugin_<id>_*` |

## Three-Tier Access Pattern

The same `IDatabaseService` exposes three abstraction levels. Pick the lightest that fits.

**Tier 1 — Raw Collections** for aggregations or bulk ops:

```typescript
const collection = database.getCollection<TransactionDoc>('transactions');
const cursor = collection.aggregate([
    { $match: { blockNumber: { $gte: 1000 } } },
    { $group: { _id: '$type', count: { $sum: 1 } } }
]);
```

**Tier 2 — Mongoose Model Registry** to preserve schema validation, defaults, hooks, virtuals:

```typescript
database.registerModel('system_config', SystemConfigModel);
const config = await database.findOne('system_config', { key: 'system' });
// findOne uses SystemConfigModel.findOne() with validation
```

**Tier 3 — Convenience Methods** prefer registered Mongoose models, fall back to raw collection access. Reduces boilerplate for standard CRUD: `find`, `findOne`, `insertOne`, `updateMany`, `deleteMany`, `count`.

## Key-Value Storage

For simple config and state, `IDatabaseService` exposes a key-value API backed by a `_kv` collection (auto-prefixed for plugins to `plugin_<id>__kv`):

```typescript
await database.set('lastSyncTime', new Date());
const lastSync = await database.get<Date>('lastSyncTime');
await database.delete('tempCache');
```

## Consumer-Specific Patterns

### Modules

Modules receive `IDatabaseService` via DI in `init(deps)`. Unlike plugins, modules **manually** prefix collection names with `module_{module-id}_{collection}` to make ownership obvious in the database.

```typescript
async init(deps: IMyModuleDependencies) {
    this.database = deps.database;
    this.database.registerModel('module_my-feature_items', MyModel);
}
```

Full module pattern: [modules.md](./modules/modules.md).

### Services

Services implementing `IXxxService` interfaces are singletons configured once at bootstrap. The constructor stores `IDatabaseService`, registers any Mongoose models, and grabs typed collection handles. Singleton lifecycle and `setDependencies` / `getInstance` pattern: [modules.md → service types](./modules/modules.md#service-types-and-singleton-usage).

### Plugins

Plugins receive a prefix-scoped `IDatabaseService` instance via `context.database`. Logical names are auto-rewritten:

```typescript
export const whaleAlertsPlugin = definePlugin({
    install: async ({ database }) => {
        await database.createIndex('subscriptions', { userId: 1 }, { unique: true });
        await database.set('config', { enabled: true, threshold: 500_000 });
    },
    init: async ({ database }) => {
        const config = await database.get<{ enabled: boolean }>('config');
        if (!config?.enabled) return;
        const subs = await database.find('subscriptions', { active: true });
    }
});
```

Plugins type their database as `IDatabaseService` — the same interface core uses; the prefix scoping lives in the implementation, not the type.

| Hook | When it runs | Database tasks |
|---|---|---|
| `install` | First introduction or upgrade | Create indexes, seed defaults, write version markers |
| `init` | Every boot | Load config via `get()`, hydrate observers, wire jobs |
| `uninstall` | Plugin removal | Drop collections or clear `_kv` if appropriate |

Full plugin database patterns: [plugins-system-architecture.md](../plugins/plugins-system-architecture.md).

## Namespace Isolation

| Consumer | Logical name | Physical collection |
|---|---|---|
| Module (user) | `gsc_queries` | `module_user_gsc_queries` |
| Module (user, legacy) | `users` | `users` (predates the convention) |
| Plugin (whale-alerts) | `subscriptions` | `plugin_whale-alerts_subscriptions` |
| Plugin (whale-alerts) | `_kv` | `plugin_whale-alerts__kv` |
| Plugin (telegram-bot) | `subscriptions` | `plugin_telegram-bot_subscriptions` |

Legacy unprefixed collections (`users`, `pages`, `menu_nodes`, `themes`) predate the convention and will be migrated over time.

**How isolation actually works:** plugin databases prepend `plugin_<id>_` to *every* logical name passed to `getCollection`. A plugin calling `database.getCollection('system_config')` does **not** throw — it silently rewrites to `plugin_<id>_system_config`, a new namespaced collection. The plugin literally cannot reach the system's `system_config`, but isolation is enforced by transparent rewriting, not by error. The defensive throw inside `DatabaseService.getCollection` only fires if a physical name somehow bypasses prefixing, which the public API never does. Two plugins using the same logical name (`subscriptions`) get separate physical collections.

## Quick Reference

### Available Methods

| Method | Purpose | Mongoose-aware |
|---|---|---|
| `getCollection(name)` | Raw MongoDB collection | No |
| `registerModel(name, model)` | Register Mongoose model | — |
| `getModel(name)` | Retrieve registered model | — |
| `find(name, filter, options)` | Query multiple | Yes |
| `findOne(name, filter)` | Query single | Yes |
| `insertOne(name, doc)` | Insert | Yes |
| `updateMany(name, filter, update)` | Update | Yes |
| `deleteMany(name, filter)` | Delete | Yes |
| `count(name, filter)` | Count | Yes |
| `createIndex(name, spec, options)` | Create index | No |
| `get(key)` / `set(key, value)` / `delete(key)` | KV storage | No |

`IDatabaseService` also exposes 6 migration methods (`initializeMigrations`, `getMigrationsPending`, `getMigrationsCompleted`, `executeMigration`, `executeMigrationsAll`, `isMigrationRunning`) — see [system-database-migrations.md](./system-database-migrations.md).

### Index Creation

Create indexes during module `init()` or plugin `install()`:

```typescript
await database.createIndex('transactions', { txId: 1 }, { unique: true });
await database.createIndex('transactions', { blockNumber: 1, timestamp: -1 });
await database.createIndex('logs', { timestamp: 1 }, { expireAfterSeconds: 2592000 }); // TTL 30d
await database.createIndex('users', { email: 1 }, { unique: true, sparse: true });
```

### Error Handling

Mongo throws `error.code === 11000` on duplicate key. Either rely on `upsert: true` in your update, or catch:

```typescript
try {
    await database.insertOne('transactions', { txId, ...data });
} catch (error) {
    if (error.code === 11000) return; // already indexed
    throw error;
}
```

## Further Reading

- [modules.md](./modules/modules.md) — Module DI patterns, service singletons
- [system-database-migrations.md](./system-database-migrations.md) — Schema evolution, migration methods on `IDatabaseService`
- [system-testing.md](./system-testing.md) — Mock `IDatabaseService` for tests
- [plugins-system-architecture.md](../plugins/plugins-system-architecture.md) — Plugin lifecycle and `context.database`
- Source: `packages/types/src/database/IDatabaseService.ts` (interface), `src/backend/modules/database/services/database.service.ts` (implementation), `src/backend/modules/database/services/plugin-database.service.ts` (plugin subclass)
