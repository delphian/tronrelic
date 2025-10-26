# Writing Database Migrations

This guide explains how to write database migrations for TronRelic. Migrations enable incremental schema changes, data transformations, and index creation across system code, modules, and plugins.

**For system architecture, REST API reference, and operational troubleshooting, see [Database Migration System Documentation](../../../../docs/system/system-database-migrations.md).**

## Why Migrations Matter

Database migrations solve critical problems in production systems:

- **Schema evolution without downtime** - Add indexes, restructure documents, and modify collections while the application continues running
- **Repeatable deployments** - Every environment (dev, staging, production) executes the same database changes in the same order
- **Team coordination** - Multiple developers can contribute schema changes without conflicts or manual database scripts
- **Rollback safety** - Failed migrations are tracked and can be retried or fixed with new forward migrations

Without migrations:

- ❌ Manual database changes create inconsistencies between environments
- ❌ Schema changes require downtime for manual application
- ❌ No audit trail of what changed, when, or why
- ❌ Breaking changes can silently corrupt data

## Quick Start

Create a migration in three steps:

1. **Create file** in appropriate migrations directory:
   - System: `apps/backend/src/services/database/migrations/`
   - Module: `apps/backend/src/modules/{module-name}/migrations/`
   - Plugin: `packages/plugins/{plugin-id}/src/backend/migrations/`

2. **Name file** following convention: `{3-digit-number}_{description}.ts`
   - Examples: `001_create_users.ts`, `042_add_indexes.ts`

3. **Export migration object** implementing `IMigration` interface:
   ```typescript
   import type { IMigration, IDatabaseService } from '@tronrelic/types';

   export const migration: IMigration = {
       id: '001_create_users',
       description: 'Create users collection with unique email index',
       dependencies: [],
       async up(database: IDatabaseService): Promise<void> {
           await database.createIndex('users', { email: 1 }, { unique: true });
       }
   };
   ```

Migrations are discovered automatically at backend startup. No registration or imports needed.

## Naming Conventions

### File Names

Migration files **must** match this pattern: `/^\d{3}_[a-z0-9_-]+\.ts$/`

**Valid examples:**
```
001_create_users.ts
042_add_menu_indexes.ts
123_migrate_legacy_transactions.ts
```

**Invalid examples:**
```
1_create_users.ts              ❌ Not enough leading zeros
001-create-users.ts            ❌ Hyphen instead of underscore separator
001_CreateUsers.ts             ❌ Uppercase letters
create_users.ts                ❌ Missing numeric prefix
```

**Why this matters:**

- Numeric prefixes provide natural sorting order within a source (system, module, plugin)
- Three-digit format supports up to 999 migrations per source
- Scanner validates naming at startup and rejects invalid files

### Migration IDs

The migration ID **must** match the filename (excluding `.ts` extension):

```typescript
// File: 001_create_users.ts
export const migration: IMigration = {
    id: '001_create_users',  // ✅ Matches filename
    // ...
};
```

**ID format rules:**

- Must start with 3 digits followed by underscore
- Description uses lowercase letters, numbers, hyphens, and underscores only
- Keep descriptions concise but meaningful

## File Structure

### Where to Place Migrations

**System migrations** (unrestricted access to all collections):
```
apps/backend/src/services/database/migrations/
├── 001_create_system_config.ts
├── 002_add_transaction_indexes.ts
└── 003_migrate_legacy_blocks.ts
```

**Module migrations** (unrestricted access to all collections):
```
apps/backend/src/modules/markets/migrations/
├── 001_create_market_collection.ts
└── 002_add_pricing_indexes.ts

apps/backend/src/modules/menu/migrations/
└── 001_create_menu_nodes.ts
```

**Plugin migrations** (restricted to plugin-prefixed collections):
```
packages/plugins/whale-alerts/src/backend/migrations/
├── 001_create_subscriptions.ts
└── 002_add_threshold_config.ts
```

### Migration Contract

Every migration file exports a `migration` object implementing `IMigration`:

```typescript
import type { IMigration, IDatabaseService } from '@tronrelic/types';

export const migration: IMigration = {
    /**
     * Unique identifier matching filename (without .ts extension).
     */
    id: '001_create_users',

    /**
     * Human-readable description explaining why this migration exists.
     * Focus on the problem solved, not just what the code does.
     */
    description: 'Create users collection with unique email index to support authentication system. Required before user registration can function.',

    /**
     * Optional array of migration IDs that must execute before this one.
     * Use fully qualified IDs for cross-source dependencies.
     */
    dependencies: [],

    /**
     * Execute the migration with full database service access.
     * Runs within MongoDB transaction (if supported by deployment).
     * Throw errors for failures - transaction will roll back automatically.
     */
    async up(database: IDatabaseService): Promise<void> {
        // Migration logic here
    }
};
```

## Using the Database Service

The `up()` method receives an `IDatabaseService` instance with these capabilities:

### Raw Collection Access

Use `getCollection()` for maximum flexibility:

```typescript
async up(database: IDatabaseService): Promise<void> {
    const collection = database.getCollection('transactions');

    // Query documents
    const docs = await collection.find({ status: 'pending' }).toArray();

    // Bulk update
    await collection.updateMany(
        { status: 'pending' },
        { $set: { status: 'processed' } }
    );

    // Aggregation pipeline
    const results = await collection.aggregate([
        { $match: { type: 'transfer' } },
        { $group: { _id: '$sender', count: { $sum: 1 } } }
    ]).toArray();
}
```

### Creating Indexes

Indexes improve query performance and enforce constraints:

```typescript
async up(database: IDatabaseService): Promise<void> {
    // Single field index
    await database.createIndex('users', { email: 1 }, { unique: true });

    // Compound index
    await database.createIndex('transactions',
        { blockNumber: 1, timestamp: -1 },
        { name: 'idx_block_time' }
    );

    // TTL index (auto-delete after 30 days)
    await database.createIndex('logs',
        { timestamp: 1 },
        { expireAfterSeconds: 2592000 }
    );

    // Sparse index (only indexes documents with field)
    await database.createIndex('users',
        { apiKey: 1 },
        { unique: true, sparse: true }
    );
}
```

### Convenience CRUD Methods

Use helper methods for common operations:

```typescript
async up(database: IDatabaseService): Promise<void> {
    // Find documents
    const users = await database.find('users', { active: true });

    // Find one document
    const config = await database.findOne('system_config', { key: 'version' });

    // Insert document
    await database.insertOne('users', {
        email: 'admin@example.com',
        role: 'admin',
        createdAt: new Date()
    });

    // Update many documents
    await database.updateMany(
        'users',
        { emailVerified: false },
        { $set: { emailVerified: true } }
    );

    // Delete documents
    await database.deleteMany('logs', { timestamp: { $lt: cutoffDate } });

    // Count documents
    const count = await database.count('transactions', { status: 'pending' });
}
```

### Key-Value Storage

Use `get()`/`set()` for simple configuration:

```typescript
async up(database: IDatabaseService): Promise<void> {
    // Set configuration value
    await database.set('migration_version', '2.0.0');

    // Get configuration value
    const version = await database.get<string>('migration_version');

    // Store complex objects
    await database.set('feature_flags', {
        newUI: true,
        betaFeatures: false,
        maintenanceMode: false
    });
}
```

## Dependency Management

### Declaring Dependencies

Use the `dependencies` array to declare required migrations:

```typescript
export const migration: IMigration = {
    id: '003_create_whale_subscriptions',
    description: 'Create whale alert subscriptions collection',

    // This migration depends on users collection existing
    dependencies: ['001_create_users'],

    async up(database: IDatabaseService): Promise<void> {
        await database.createIndex('whale_subscriptions',
            { userId: 1, enabled: 1 }
        );
    }
};
```

### Cross-Source Dependencies

Migrations can depend on migrations from other sources:

```typescript
// Plugin migration depending on system migration
export const migration: IMigration = {
    id: '001_create_plugin_data',
    description: 'Create plugin data collection',

    // Qualified ID references system migration
    dependencies: ['001_create_system_config'],

    async up(database: IDatabaseService): Promise<void> {
        // Plugin logic here
    }
};
```

**Qualified ID formats:**
- System migration: `'001_create_users'`
- Module migration: `'module:markets:001_create_markets'`
- Plugin migration: `'plugin:whale-alerts:001_create_subscriptions'`

### Dependency Resolution

The migration system:

1. **Validates dependencies exist** - Missing dependencies cause startup error
2. **Detects circular dependencies** - Cycles are rejected with error showing the cycle path
3. **Sorts topologically** - Migrations execute in dependency order automatically
4. **Stops on failure** - If a dependency fails, dependents don't execute

## Access Control

### System and Module Migrations

System and module migrations have **unrestricted access** to all collections:

```typescript
// System migration - can access ANY collection
async up(database: IDatabaseService): Promise<void> {
    await database.createIndex('users', { email: 1 }, { unique: true });
    await database.createIndex('transactions', { txId: 1 }, { unique: true });
    await database.createIndex('markets', { guid: 1 }, { unique: true });
    // ✅ All allowed
}
```

### Plugin Migrations

Plugin migrations are **restricted to plugin-prefixed collections**:

```typescript
// Plugin: whale-alerts
async up(database: IDatabaseService): Promise<void> {
    // ✅ Access plugin-prefixed collection (auto-prefixed to 'plugin_whale-alerts_subscriptions')
    await database.createIndex('subscriptions', { userId: 1 });

    // ✅ Use key-value storage (scoped to plugin)
    await database.set('config', { threshold: 1000000 });

    // ❌ ERROR - Cannot access non-prefixed collection
    await database.createIndex('users', { email: 1 }); // Throws error
}
```

**Why this restriction exists:**

- Plugins should not modify core collections directly
- Prevents plugins from corrupting system data
- Enforces isolation between plugins
- Use dependencies to ensure required system migrations run first

## Transaction Behavior

### Automatic Transaction Wrapping

Migrations execute within MongoDB transactions automatically (when supported):

```typescript
async up(database: IDatabaseService): Promise<void> {
    // All operations run in a single transaction
    await database.insertOne('users', { email: 'admin@example.com' });
    await database.createIndex('users', { email: 1 }, { unique: true });
    await database.set('initialized', true);

    // If any operation fails, ALL operations roll back
}
```

**Transaction support requirements:**
- MongoDB 4.0+ with WiredTiger storage engine
- Replica set deployment (not standalone MongoDB)

**Without transaction support:**
- Migrations run without transaction protection
- Partial modifications possible on failure
- Application crashes if migration fails (prevents continuing with corrupted data)

### Rollback on Failure

If a migration throws an error:

1. **Transaction rolls back** (if transactions supported)
2. **Migration marked as failed** in tracking collection
3. **Remaining migrations don't execute**
4. **Application continues running** (no crash)

If rollback fails:

1. **Application crashes with `process.exit(1)`**
2. **Prevents continuing with corrupted data**
3. **Operator must manually investigate and recover**

## Best Practices

### Write Idempotent Migrations

Migrations should be safe to run multiple times:

```typescript
// ✅ Good - Check before insert
async up(database: IDatabaseService): Promise<void> {
    const existing = await database.findOne('system_config', { key: 'version' });
    if (!existing) {
        await database.insertOne('system_config', { key: 'version', value: '1.0.0' });
    }
}

// ❌ Bad - Fails on second run
async up(database: IDatabaseService): Promise<void> {
    await database.insertOne('system_config', { key: 'version', value: '1.0.0' });
    // Throws duplicate key error if run twice
}
```

**Idempotent patterns:**
- Use `updateMany()` with `$set` instead of `insertOne()`
- Check for existence before creating
- Use `upsert` operations where appropriate
- Index creation is idempotent by default

### Validate Assumptions

Check that required data exists before proceeding:

```typescript
async up(database: IDatabaseService): Promise<void> {
    // Validate dependency data exists
    const systemConfig = await database.findOne('system_config', { key: 'initialized' });
    if (!systemConfig) {
        throw new Error('System not initialized. Run migration 001_init_system first.');
    }

    // Proceed with migration
    await database.createIndex('users', { systemId: 1 });
}
```

### Use Descriptive Error Messages

Help future debugging by providing context:

```typescript
async up(database: IDatabaseService): Promise<void> {
    const users = await database.find('users', { role: 'admin' });

    if (users.length === 0) {
        throw new Error(
            'No admin users found. This migration requires at least one admin user. ' +
            'Run migration 002_create_default_admin before this migration.'
        );
    }

    // Proceed with migration
}
```

### Add Indexes Before Heavy Queries

If you need to query many documents, add indexes first:

```typescript
async up(database: IDatabaseService): Promise<void> {
    // Add index BEFORE querying
    await database.createIndex('transactions', { status: 1 });

    // Now query benefits from index
    const pending = await database.find('transactions', { status: 'pending' });

    // Process documents
    for (const tx of pending) {
        // Transform data
    }
}
```

### Avoid Hardcoded Values

Use dynamic values for calculations:

```typescript
// ✅ Good - Uses dynamic chain parameters
async up(database: IDatabaseService): Promise<void> {
    const energyCost = await database.get<number>('current_energy_cost');

    await database.updateMany(
        'markets',
        {},
        { $set: { energyCost } }
    );
}

// ❌ Bad - Hardcoded value breaks when network changes
async up(database: IDatabaseService): Promise<void> {
    await database.updateMany(
        'markets',
        {},
        { $set: { energyCost: 65000 } } // This will be wrong later
    );
}
```

## Testing Migrations

### Test Against Realistic Data

Use production-like datasets when testing migrations:

```typescript
// Create test data that mimics production scale
async up(database: IDatabaseService): Promise<void> {
    const transactions = await database.find('transactions', {});

    // If testing with 10 transactions, migration might be fast
    // If production has 10M transactions, migration might timeout

    // Plan for scale from the start
}
```

### Test Failure Scenarios

Verify error handling works correctly:

```typescript
async up(database: IDatabaseService): Promise<void> {
    // What if this collection doesn't exist?
    const users = await database.find('users', {});

    // What if no users exist?
    if (users.length === 0) {
        throw new Error('No users found - cannot proceed');
    }

    // What if transformation fails?
    for (const user of users) {
        if (!user.email) {
            throw new Error(`User ${user._id} missing required email field`);
        }
    }
}
```

### Verify Idempotency

Run migrations multiple times during testing:

```bash
# Run migration
npm run migrate

# Run again - should succeed without changes
npm run migrate

# Check database state - should be identical
```

## Common Patterns

### Pattern: Adding Indexes

```typescript
export const migration: IMigration = {
    id: '001_add_transaction_indexes',
    description: 'Add indexes to transactions collection for performance. Optimizes whale transaction queries by 100x.',
    dependencies: [],

    async up(database: IDatabaseService): Promise<void> {
        // Unique index on transaction ID
        await database.createIndex(
            'transactions',
            { txId: 1 },
            { unique: true, name: 'idx_txid' }
        );

        // Compound index for time-based queries
        await database.createIndex(
            'transactions',
            { blockNumber: 1, timestamp: -1 },
            { name: 'idx_block_time' }
        );

        // Index for filtering by value
        await database.createIndex(
            'transactions',
            { valueUsd: 1 },
            { name: 'idx_value_usd' }
        );
    }
};
```

### Pattern: Data Transformation

```typescript
export const migration: IMigration = {
    id: '002_migrate_legacy_format',
    description: 'Transform legacy transaction format to new nested structure. Required for new observer pattern.',
    dependencies: ['001_add_transaction_indexes'],

    async up(database: IDatabaseService): Promise<void> {
        const collection = database.getCollection('transactions');

        // Find documents with legacy format
        const legacyDocs = await collection.find({ legacyFormat: true }).toArray();

        for (const doc of legacyDocs) {
            // Transform structure
            const transformed = {
                ...doc,
                contracts: [{
                    type: doc.type,
                    parameter: doc.parameter
                }],
                legacyFormat: undefined // Remove flag
            };

            // Update document
            await collection.updateOne(
                { _id: doc._id },
                { $set: transformed }
            );
        }
    }
};
```

### Pattern: Seeding Defaults

```typescript
export const migration: IMigration = {
    id: '001_seed_default_config',
    description: 'Seed default system configuration required for application startup.',
    dependencies: [],

    async up(database: IDatabaseService): Promise<void> {
        // Check if already seeded (idempotent)
        const existing = await database.get('system_config');
        if (existing) {
            return;
        }

        // Seed defaults
        await database.set('system_config', {
            version: '1.0.0',
            initialized: true,
            createdAt: new Date()
        });
    }
};
```

### Pattern: Collection Restructuring

```typescript
export const migration: IMigration = {
    id: '003_split_user_roles',
    description: 'Split user roles into separate roles collection for flexibility. Enables role-based access control.',
    dependencies: ['001_create_users'],

    async up(database: IDatabaseService): Promise<void> {
        const users = database.getCollection('users');

        // Create roles collection and indexes
        await database.createIndex('roles',
            { userId: 1 },
            { name: 'idx_user_id' }
        );

        // Migrate embedded roles to separate collection
        const usersWithRoles = await users.find({ roles: { $exists: true } }).toArray();

        for (const user of usersWithRoles) {
            // Insert roles into new collection
            for (const role of user.roles) {
                await database.insertOne('roles', {
                    userId: user._id,
                    role,
                    createdAt: new Date()
                });
            }

            // Remove roles from user document
            await users.updateOne(
                { _id: user._id },
                { $unset: { roles: '' } }
            );
        }
    }
};
```

## Troubleshooting

### Migration Won't Execute

**Check migration is discovered:**
```bash
# View pending migrations in admin UI
# Navigate to /system/database
# Check "Pending Migrations" section
```

**Verify naming convention:**
- Filename matches pattern: `\d{3}_[a-z0-9_-]+\.ts`
- ID in file matches filename

**Check dependencies:**
- All dependencies exist
- No circular dependencies
- Dependencies completed successfully

### Migration Fails During Execution

**Check logs:**
```bash
tail -100 .run/backend.log | grep -i migration
```

**Review error message:**
- Validation errors (missing fields, wrong types)
- Network errors (database connection)
- Permission errors (plugin accessing non-prefixed collection)

**Retry failed migration:**
- Fix the code
- Rebuild backend
- Execute from admin UI (`/system/database`)

### Changes Not Applying

**Verify rebuild:**
```bash
./scripts/start.sh --force-build
```

**Check database state:**
```bash
docker exec -it tronrelic-mongo mongosh tronrelic
> db.migrations.find({ migrationId: '001_example' })
```

**Confirm execution:**
- Check "Migration History" in `/system/database`
- Look for migration ID with status "completed"

## Related Documentation

**Migration system overview:**
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) - Complete system architecture, REST API reference, admin UI guide, lifecycle documentation, and operational troubleshooting

**Example migrations:**
- [docs/system/migration-examples/](../../../../docs/system/migration-examples/) - System, module, and plugin migration examples with comments

**Interface contracts:**
- [IDatabaseService.ts](../../../../../packages/types/src/database/IDatabaseService.ts) - Database service API with method signatures
- [IMigration.ts](../../../../../packages/types/src/database/IMigration.ts) - Migration contract with field documentation
