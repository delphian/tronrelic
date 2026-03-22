# Database Migration System

Forward-only schema evolution with dependency tracking, transaction support, and admin UI. Migrations are discovered automatically from system, module, and plugin directories, executed serially, and tracked in MongoDB.

## Why This Matters

Migrations keep database schemas consistent across environments without downtime. Without them, manual changes drift between dev/staging/production, schema updates require restarts, breaking changes corrupt data silently, and there is no audit trail for debugging.

## When to Use Migrations

Migrations change EXISTING production databases. If your module has never been deployed, let Mongoose handle initial schema via `index: true` / `unique: true` in schema definitions. Only create migrations when you need to modify schemas or data that already exist in production.

## How It Works

### Discovery and Scanning

`MigrationScanner` discovers files at startup from three locations:

| Source | Path | Use For |
|--------|------|---------|
| System | `src/backend/services/database/migrations/` | Cross-cutting concerns with no single module owner |
| Module | `src/backend/modules/*/migrations/` | Changes owned by a specific module |
| Plugin | `src/plugins/*/src/backend/migrations/` | Plugin-scoped changes |

**Filename pattern:** `/^\d{3}_[a-z0-9_-]+\.(ts|js)$/` — both `.ts` (dev) and `.js` (Docker) accepted. The scanner also validates that `migration.id` matches the filename (minus extension) to catch copy-paste errors.

**Scanning workflow:** filesystem traversal, filename validation, dynamic import, structure validation (`export const migration` implementing `IMigration`), SHA-256 checksum, dependency graph construction, circular dependency detection (DFS), topological sort.

**Sort strategies:** `'id'` (default, lexicographic), `'timestamp'` (file mtime), `'source-then-id'` (system first, then modules, then plugins).

### Qualified IDs and Dependencies

Each migration gets a `qualifiedId` used for tracking and dependency resolution:

| Source | qualifiedId Format | Example |
|--------|--------------------|---------|
| System | plain ID | `001_create_users` |
| Module | `module:{name}:{id}` | `module:menu:001_add_namespace` |
| Plugin | `plugin:{id}:{id}` | `plugin:whale-alerts:001_init` |

Dependencies reference the target's `qualifiedId`. System migrations can use plain IDs since their qualifiedId IS the plain ID. Module/plugin migrations require the qualified prefix:

```typescript
dependencies: [
    '001_create_users',                    // System (plain ID)
    'module:menu:001_add_namespace'        // Module (qualified ID required)
]
```

Circular dependencies throw at startup with the cycle path.

### Execution and Transactions

`MigrationExecutor` runs migrations serially and accepts an optional `IClickHouseService` for ClickHouse-targeted migrations.

**With transaction support (replica set):** wraps `migration.up(context)` in `session.withTransaction()`. On failure, transaction rolls back automatically, failure is recorded, error is thrown.

**Without transaction support (standalone MongoDB):** executes `migration.up(context)` directly. On failure, calls `process.exit(1)` since partial modifications cannot be rolled back.

ClickHouse-targeted migrations are skipped with a warning if ClickHouse is not configured.

### IMigration Interface

```typescript
import type { IMigration, IMigrationContext } from '@tronrelic/types';

export const migration: IMigration = {
    id: '001_example',
    description: 'Why this migration exists and what it changes',
    target: 'mongodb',        // Optional. 'mongodb' (default) or 'clickhouse'
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        // MongoDB: use context.database
        await context.database.createIndex('users', { email: 1 }, { unique: true });

        // ClickHouse (when target: 'clickhouse'): use context.clickhouse
        // await context.clickhouse!.exec('CREATE TABLE ...');
    }
};
```

`IMigrationContext` provides `{ database: IDatabaseService, clickhouse?: IClickHouseService }`. System/module migrations access any collection. Plugin migrations are restricted to plugin-prefixed collections only.

### State Tracking

`MigrationTracker` persists execution records in the `migrations` collection:

| Field | Type | Description |
|-------|------|-------------|
| `migrationId` | string | qualifiedId of the migration |
| `status` | `'completed'` \| `'failed'` | Execution outcome |
| `source` | string | `system`, `module:*`, `plugin:*` |
| `executedAt` | Date | Execution timestamp |
| `executionDuration` | number | Duration in milliseconds |
| `error` / `errorStack` | string? | Error details if failed |
| `checksum` | string? | SHA-256 of migration file at execution time |
| `environment` | string? | NODE_ENV |
| `codebaseVersion` | string? | `git rev-parse HEAD` if available |

**Indexes:** `{ migrationId: 1 }` (unique), `{ executedAt: -1 }`, `{ status: 1, executedAt: -1 }`.

**State rules:** Completed migrations never re-execute. Failed migrations remain pending (retryable). Orphaned records (code deleted) cleaned up for non-completed entries.

## Quick Reference

### REST API

All endpoints require `x-admin-token` header.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/migrations/status` | GET | Pending metadata array, completed `IMigrationRecord[]`, `isRunning`, counts |
| `/api/admin/migrations/history` | GET | Execution history. Params: `limit` (default 100, max 500), `status` (all/completed/failed) |
| `/api/admin/migrations/execute` | POST | Body `{}` runs all pending. Body `{"migrationId":"..."}` runs one. Returns `{ success, executed[], failed? }`. 409 if running, 404 if not found |
| `/api/admin/migrations/:id` | GET | Returns `{ migration, isPending, executions[] }`. 404 if not found |

### Admin UI

Accessible at `/system/database` (requires admin token). Displays pending/completed counts, running indicator, execute-all and per-migration buttons, auto-refresh (5s), history table with status/source filtering, and expandable error details. Status badges: green (completed), red (failed), yellow (running).

## Troubleshooting

**Migration not discovered:** Verify filename matches `\d{3}_[a-z0-9_-]+\.(ts|js)`, file is in correct location, exports `migration` object with `id`, `description`, `up()`, and that `migration.id` matches filename. Check backend logs for scanner warnings.

**Execution failure:** Click "Show Error" in admin UI. Common causes: duplicate key (make operations idempotent), missing dependency (add to `dependencies[]`), plugin accessing non-prefixed collections. Failed migrations remain pending for retry after fix.

**Stuck "Running":** If backend crashed, restart — the `isExecuting` flag resets. Review migration for infinite loops or blocking operations.

**Circular dependency:** Error message shows cycle path. Remove one dependency to break the cycle.

**Missing dependency:** Check for typos, ensure dependency file exists with valid filename, use qualified IDs for module/plugin dependencies.

**Crash without transactions:** Application exits with `process.exit(1)` when migration fails on standalone MongoDB. Data may be partially modified. Verify database state manually, make migration idempotent, or use replica set for transaction support.

## Further Reading

**Implementation:**
- [MigrationScanner.ts](../../src/backend/modules/database/migration/MigrationScanner.ts) — Discovery, validation, dependency resolution
- [MigrationExecutor.ts](../../src/backend/modules/database/migration/MigrationExecutor.ts) — Transaction-wrapped execution
- [MigrationTracker.ts](../../src/backend/modules/database/migration/MigrationTracker.ts) — State persistence and history

**Related topics:**
- [system-database.md](./system-database.md) — Database access architecture and `IDatabaseService` usage
- [system-testing.md](./system-testing.md) — Testing framework for database services
- [environment.md](../environment.md) — `ADMIN_API_TOKEN` configuration
