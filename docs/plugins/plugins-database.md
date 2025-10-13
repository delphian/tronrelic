# Plugin Database Access

TronRelic gives every plugin its own MongoDB sandbox so features can store state without colliding with each other. The database helper keeps that sandbox tidy: it prefixes every collection name, exposes simple helpers for common reads and writes, and plugs straight into the plugin lifecycle so setup happens exactly once.

## Why Plugin Storage Exists

- **Plugins need durable memory.** Whale alerts, delegation stats, and scheduled jobs all depend on data that lives longer than a single block.
- **Shared collections caused collisions.** Prefixing every collection with the plugin id guarantees that features cannot overwrite each other's documents.
- **Consistent tooling reduces mistakes.** A single, framework-free API means plugin authors never have to juggle raw Mongoose instances or guess when to create indexes.

## How the Storage Flow Works

1. **Loader creates an isolated service** for each plugin id as the backend boots.
2. **The service is injected** into `context.database` for every lifecycle hook (`install`, `init`, `uninstall`).
3. **Collection names are auto-prefixed** (`plugin_whale-alerts_alerts`, `plugin_delegation-tracker_flows`, etc.).
4. **Key-value helpers share the same prefixing**, storing values in a private `_kv` collection.
5. **Plugins call the API directly**—no extra wiring, no imports from MongoDB or Mongoose required.

## Core Capabilities

### 1. Scoped collections (structured data)

- Use `getCollection()` when you need the power of the MongoDB driver.
- Prefer the helper methods (`find`, `insertOne`, `updateMany`, etc.) for simple CRUD—they already apply the prefix, pass through type parameters, and return plain JS objects.

```typescript
// Inside install/init/uninstall hooks
await context.database.insertOne('alerts', {
    userId,
    txId,
    amountTRX,
    createdAt: new Date()
});

const openAlerts = await context.database.find('alerts', { dismissed: false });
```

### 2. Key-value storage (configuration/state)

- Useful for single-document settings or counters.
- Stored in a companion collection named `plugin_<id>__kv`.

```typescript
await context.database.set('config', { enabled: true, threshold: 1_000_000 });

const config = await context.database.get<{ enabled: boolean }>('config');
if (!config?.enabled) {
    return; // Exit early if the plugin is disabled
}
```

### 3. Lifecycle-aware setup

- `install` runs only when the plugin is first introduced (or upgraded)—create indexes and seed defaults here.
- `init` runs on every boot—load config, hydrate observers, and schedule jobs.
- `uninstall` is optional cleanup for disposable features.

```typescript
export const whaleAlertsPlugin = definePlugin({
    manifest: whaleAlertsManifest,

    install: async ({ database }) => {
        await database.createIndex('subscriptions', { userId: 1, alertType: 1 }, { unique: true });
        await database.set('config', { enabled: true, threshold: 500_000 });
    },

    init: async ({ database, observerRegistry, websocketService }) => {
        const config = await database.get<{ enabled: boolean; threshold: number }>('config');
        if (!config?.enabled) {
            return;
        }

        const observer = createWhaleObserver(database, websocketService, config.threshold);
        observerRegistry.subscribeTransactionType('TransferContract', observer);
    }
});
```

### 4. Indexes that match your workload

- Create indexes in `install` so MongoDB optimises queries before the plugin goes live.
- Use compound indexes for multi-field lookups (for example, `userId + alertType`), and TTL indexes for automatic expiry of dismissed alerts.

```typescript
await database.createIndex(
    'alerts',
    { dismissed: 1, updatedAt: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 30 } // 30 days for dismissed alerts
);
```

## Step-by-Step Usage Checklist

1. **During install**
    - Create indexes, seed defaults, and record any version markers you need for migrations.
2. **During init**
    - Load configuration via `database.get`, instantiate observers, and wire up background jobs.
3. **When reacting to events**
    - Use the helper methods (`find`, `insertOne`, `updateMany`, `deleteMany`) for transactional logic.
4. **When shutting down a plugin**
    - Optionally drop collections or clear key-value entries in `uninstall`.

## Good Practices

- **Model data deliberately.** Keep documents small, add indexes only for the queries you actually run, and batch writes when possible.
- **Handle missing configuration gracefully.** Treat `database.get('config')` returning `undefined` as a cue to run installer logic or disable the feature.
- **Avoid leaking the raw collection.** The helper methods already handle prefixing; only reach for `getCollection()` when you need advanced operators or aggregations.
- **Document your schema.** Add a short README in the plugin directory describing stored collections and keys so future contributors know what to expect.

## Quick Reference

| Operation                  | Call                                         | Notes |
|---------------------------|----------------------------------------------|-------|
| Read/write a setting      | `database.get('config')`, `database.set('config', value)` | Stored in `_kv`, handy for feature flags |
| Query documents           | `database.find('alerts', { dismissed: false })`           | Applies plugin prefix automatically |
| Ensure unique data        | `database.createIndex('subscriptions', { userId: 1, alertType: 1 }, { unique: true })` | Run inside `install` |
| Remove data               | `database.deleteMany('alerts', { dismissed: true })`      | Safe namespace isolation |

By keeping the “why” front and center—isolated state, predictable lifecycles, and low-friction helpers—plugins stay fast to build and safe to maintain. Use the checklist above to decide what to run in each hook, and lean on the helpers instead of rolling custom MongoDB plumbing. The result is consistent, testable features that never step on each other’s data.

