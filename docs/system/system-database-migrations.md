# Database Migration System

This document provides complete technical documentation for TronRelic's database migration system. For practical guidance on writing migrations, see the [Migration Authoring Guide](../../apps/backend/src/services/database/migrations/README.md).

## Who This Document Is For

Backend developers implementing database schema changes, operations engineers troubleshooting migration failures, and maintainers understanding the migration system architecture.

## Why This Matters

Database migrations solve critical production problems:

- **Schema evolution without downtime** - Add indexes, restructure collections, and transform data while the application runs
- **Repeatable deployments** - Every environment (dev, staging, production) executes the same changes in the same order
- **Team coordination** - Multiple developers contribute schema changes without conflicts or manual scripts
- **Audit trail** - Complete history of what changed, when, who executed it, and why

When migrations are missing or broken:

- ❌ Manual database changes create inconsistencies between environments (production differs from staging)
- ❌ Schema changes require downtime for manual application (users see outages)
- ❌ No record of what changed or why (debugging production issues becomes guesswork)
- ❌ Breaking changes can silently corrupt data (no validation or rollback)
- ❌ Team members overwrite each other's database modifications (no coordination)

Understanding the migration system helps you safely evolve database schemas, troubleshoot execution failures, and maintain production data integrity.

## When to Use Migrations

**Migrations are for changing EXISTING production databases, not initial setup.**

### Use migrations for:

- ✅ **Adding indexes to EXISTING deployed collections** - Production already has data, need to add performance indexes
- ✅ **Modifying data in production databases** - Transform document structure, add default values, migrate formats
- ✅ **Restructuring documents across environments** - Split fields, combine collections, normalize data
- ✅ **Schema changes to deployed collections** - Add fields, rename fields, change types

### Do NOT use migrations for:

- ❌ **Initial setup of new modules** - Mongoose handles this automatically via schema definitions
- ❌ **Creating indexes defined in schema** - Mongoose auto-creates these on first model load
- ❌ **Collections that don't exist in production yet** - No migration needed for new features

### Rule of thumb:

**If your module has never been deployed to production, don't create migrations.** Let Mongoose handle initial schema setup through schema definitions with `index: true`, `unique: true`, etc.

**Only create migrations when you need to modify schemas/data that already exist in production.**

**Example scenarios:**

- ✅ **Migration needed**: Production has `users` collection without `emailVerified` field. Create migration to add default value.
- ❌ **Migration NOT needed**: Building new `pages` module that's never been deployed. Mongoose will create indexes from schema.
- ✅ **Migration needed**: Production has `transactions` collection. Need to add compound index for performance. Create migration.
- ❌ **Migration NOT needed**: New plugin with new collection. Schema definitions handle all initial setup.

For complete guidance on writing migrations with code examples, see [Migration Authoring Guide](../../apps/backend/src/services/database/migrations/README.md).

## Core System Components

**For practical guidance on writing migrations (naming conventions, dependencies, best practices, common patterns), see [Migration Authoring Guide](../../apps/backend/src/services/database/migrations/README.md).**

### Migration Discovery and Scanning

The migration system discovers migration files automatically at application startup from three predefined locations:

**Discovery locations:**
- **System migrations**: `apps/backend/src/services/database/migrations/` - Core infrastructure changes
- **Module migrations**: `apps/backend/src/modules/*/migrations/` - Feature-specific changes
- **Plugin migrations**: `packages/plugins/*/src/backend/migrations/` - Plugin-scoped changes

**See MigrationScanner implementation:**
`apps/backend/src/services/database/migration/MigrationScanner.ts`

**Scanning workflow:**

1. **Filesystem traversal** - Recursively scans all three locations for `.ts` files
2. **Filename validation** - Rejects files not matching pattern `/^\d{3}_[a-z0-9_-]+\.ts$/`
3. **Dynamic import** - Loads migration modules using `import()`
4. **Structure validation** - Verifies exported `migration` object implements `IMigration` interface
5. **Checksum calculation** - Computes SHA-256 hash of file contents for change detection
6. **Dependency graph construction** - Builds adjacency list of migration dependencies
7. **Circular dependency detection** - Uses depth-first search to detect cycles, throws error if found
8. **Topological sort** - Sorts migrations in execution order (dependencies before dependents)

**Naming convention validation:**

```typescript
// Valid filenames (discovered and loaded)
001_create_users.ts
042_add_menu_indexes.ts
123_migrate_legacy_format.ts

// Invalid filenames (skipped with warning)
1_create_users.ts              // Not enough leading zeros
001-create-users.ts            // Hyphen instead of underscore
001_CreateUsers.ts             // Uppercase letters
create_users.ts                // Missing numeric prefix
```

**Circular dependency detection:**

```typescript
// Example cycle:
// Migration A depends on B
// Migration B depends on C
// Migration C depends on A

// Scanner detects cycle and throws:
// Error: Circular dependency detected: A -> B -> C -> A
//        Remove one of these dependencies to break the cycle.
```

**Access patterns:**

```typescript
// During backend initialization
const scanner = new MigrationScanner();
const discovered = await scanner.scan();
// Returns: IMigrationMetadata[] sorted in execution order
```

### Migration Execution and Transactions

The executor runs migrations serially with MongoDB transaction wrapping for atomicity and rollback safety.

**See MigrationExecutor implementation:**
`apps/backend/src/services/database/migration/MigrationExecutor.ts`

**Execution workflow:**

1. **Serial execution enforcement** - Checks `isExecuting` flag, throws error if migration already running
2. **Transaction support detection** - Verifies MongoDB deployment is replica set (transactions require this)
3. **Session creation** - Starts MongoDB session if transactions supported
4. **Transaction start** - Begins transaction with `session.withTransaction()`
5. **Migration execution** - Calls `migration.up(database)` within transaction
6. **Transaction commit** - Commits changes if migration succeeds
7. **Success recording** - Creates record in `migrations` collection with execution metadata
8. **Rollback on failure** - Automatically rolls back transaction if migration throws error
9. **Failure recording** - Creates failed record with error details
10. **Application crash if rollback fails** - Calls `process.exit(1)` to prevent data corruption

**Transaction support requirements:**

MongoDB transactions require:
- MongoDB 4.0+ with WiredTiger storage engine
- Replica set deployment (NOT standalone MongoDB)
- Connection string with `replicaSet` parameter

**Without transaction support:**
- Migration executes without transaction wrapper
- Partial modifications possible on failure
- Application crashes if migration fails (prevents continuing with corrupted state)

**Rollback behavior:**

```typescript
// Transaction supported (replica set deployment)
try {
    await migration.up(database);
    await transaction.commit();
    // All changes committed atomically
} catch (error) {
    await transaction.rollback();
    // ALL changes rolled back (database unchanged)
}

// Transaction NOT supported (standalone MongoDB)
try {
    await migration.up(database);
    // Changes applied directly (no transaction)
} catch (error) {
    // CANNOT roll back - data may be partially modified
    logger.fatal('Migration failed without transaction support');
    process.exit(1); // Crash to prevent continuing with corrupted data
}
```

**Access patterns:**

```typescript
const executor = new MigrationExecutor(database, tracker);

// Check if migration currently running
if (executor.isRunning()) {
    throw new Error('Cannot execute: Another migration is running');
}

// Execute single migration
await executor.executeMigration(migrationMetadata);

// Execute multiple migrations in series
await executor.executeMigrations([migration1, migration2, migration3]);
```

### Migration Tracking and State Management

The tracker maintains persistent state in MongoDB's `migrations` collection, recording all execution attempts with success/failure status.

**See MigrationTracker implementation:**
`apps/backend/src/services/database/migration/MigrationTracker.ts`

**Collection schema:**

```typescript
interface IMigrationRecord {
    migrationId: string;           // Unique migration ID
    status: 'completed' | 'failed'; // Execution outcome
    source: string;                // Source category (system, module:*, plugin:*)
    executedAt: Date;              // Execution timestamp
    executionDuration: number;     // Duration in milliseconds
    error?: string;                // Error message if failed
    errorStack?: string;           // Full stack trace if failed
    checksum?: string;             // SHA-256 hash of migration file
    environment?: string;          // NODE_ENV when executed
    codebaseVersion?: string;      // Git commit hash when executed
}
```

**Indexes:**

```typescript
// Unique index prevents duplicate execution records
{ migrationId: 1 } (unique)

// Index for chronological history queries
{ executedAt: -1 }

// Compound index for admin UI filtering
{ status: 1, executedAt: -1 }
```

**Tracking workflow:**

1. **Initialization** - Creates `migrations` collection and indexes at backend startup
2. **Pending calculation** - Compares discovered migrations against completed IDs
3. **Execution recording** - Inserts record on migration completion (success or failure)
4. **Orphan cleanup** - Removes records for migrations where code no longer exists
5. **History queries** - Provides pagination and filtering for admin UI

**State management rules:**

- **Completed migrations** - Never re-execute (marked as completed in database)
- **Failed migrations** - Remain pending (can be retried after fix)
- **Missing migrations** - Orphaned records removed if code deleted
- **Modified migrations** - Checksum change detected but not enforced (warning logged)

**Access patterns:**

```typescript
const tracker = new MigrationTracker(database);

// Get completed migration IDs
const completedIds = await tracker.getCompletedMigrationIds();
// Returns: ['001_create_users', '002_add_indexes']

// Determine pending migrations
const pending = await tracker.getPendingMigrations(discovered);
// Returns: IMigrationMetadata[] (discovered minus completed)

// Record successful execution
await tracker.recordSuccess(metadata, durationMs);

// Record failed execution
await tracker.recordFailure(metadata, error, durationMs);

// Get execution history with pagination
const history = await tracker.getCompletedMigrations(100);
// Returns: IMigrationRecord[] (newest first)

// Clean up orphaned records
const removed = await tracker.removeOrphanedPending(discovered);
// Returns: number of records deleted
```

### Admin UI and REST API

The system provides a web-based admin interface at `/system/database` and REST API endpoints for migration management.

**Admin UI location:**
`apps/frontend/app/(dashboard)/system/database/page.tsx`

**REST API controller:**
`apps/backend/src/modules/migrations/migrations.controller.ts`

**UI features:**

- **Status overview** - Displays pending count, completed count, and running state
- **Pending migrations view** - Grouped by source (system, modules, plugins) with dependency visualization
- **Execute all button** - Triggers batch execution of all pending migrations
- **Execute individual button** - Runs single migration by ID
- **Auto-refresh toggle** - Polls status every 5 seconds when enabled
- **Migration history table** - Shows execution records with filtering by status and source
- **Error detail expansion** - Click to reveal full error message and stack trace
- **Visual status indicators** - Badges show success (green), failed (red), running (blue)

**REST API endpoints:**

| Endpoint | Method | Purpose | Auth Required |
|----------|--------|---------|---------------|
| `/api/admin/migrations/status` | GET | Get pending/completed counts and running state | Admin token |
| `/api/admin/migrations/history` | GET | Get execution history with filtering | Admin token |
| `/api/admin/migrations/execute` | POST | Execute specific or all pending migrations | Admin token |
| `/api/admin/migrations/:id` | GET | Get detailed info about specific migration | Admin token |

**See [REST API Reference](#rest-api-reference) below for request/response examples.**

## Migration Lifecycle

This section walks through the complete lifecycle of a database migration from file creation through discovery, dependency resolution, execution, and completion tracking.

### Step 1: File Creation

Developer creates migration file in appropriate location:

```typescript
// File: apps/backend/src/services/database/migrations/001_create_users.ts

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

### Step 2: Discovery at Startup

Backend initialization triggers filesystem scan:

```typescript
// In DatabaseService.initializeMigrations()

const scanner = new MigrationScanner();
const discovered = await scanner.scan();
// [
//   {
//     id: '001_create_users',
//     description: '...',
//     source: 'system',
//     filePath: '/absolute/path/to/001_create_users.ts',
//     timestamp: Date,
//     checksum: 'sha256-hash',
//     dependencies: [],
//     up: Function
//   }
// ]
```

**Scanner performs:**
- Filename validation (rejects invalid patterns)
- Structure validation (ensures `IMigration` contract met)
- Checksum calculation (SHA-256 of file contents)
- Dependency validation (ensures all referenced migrations exist)

### Step 3: Dependency Resolution

Scanner builds dependency graph and sorts topologically:

```typescript
// Example with dependencies:
// 001_create_users (system migration, no deps)
// 002_create_roles (system migration, depends on 001_create_users)
// 003_assign_roles (system migration, depends on 001_create_users, 002_create_roles)

// System-to-system dependencies use plain IDs
dependencies: ['001_create_users', '002_create_roles']

const sorted = scanner.topologicalSort(discovered);
// Execution order: [001, 002, 003]
```

**Critical:** Dependency format depends on the target migration's source:

- **System migrations** - Use plain ID: `'001_create_users'` (system `qualifiedId` IS the plain ID)
- **Module migrations** - Use qualified ID: `'module:menu:001_add_namespace'`
- **Plugin migrations** - Use qualified ID: `'plugin:whale-alerts:001_init'`

The scanner builds a lookup map keyed by `qualifiedId`. System migrations have `qualifiedId = id`, but module/plugin migrations have prefixed qualified IDs.

**Circular dependency detection:**
```typescript
// If 003 also depends on 004, and 004 depends on 003:
// Error thrown: "Circular dependency detected: 003 -> 004 -> 003"
```

### Step 4: Pending Determination

Tracker compares discovered migrations against database records:

```typescript
const tracker = new MigrationTracker(database);
const pending = await tracker.getPendingMigrations(discovered);

// Database has records for: ['001_create_users', '002_create_roles']
// Discovered migrations: ['001_create_users', '002_create_roles', '003_assign_roles']
// Pending: ['003_assign_roles']
```

### Step 5: Execution

Admin triggers execution via UI or API:

```typescript
// Via admin UI: Click "Execute All Pending" button
// Via API: POST /api/admin/migrations/execute

const executor = new MigrationExecutor(database, tracker);

for (const migration of pending) {
    const startTime = Date.now();

    try {
        // Start transaction (if supported)
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            await migration.up(database);
        });

        // Record success
        const duration = Date.now() - startTime;
        await tracker.recordSuccess(migration, duration);

    } catch (error) {
        // Transaction auto-rolled back
        const duration = Date.now() - startTime;
        await tracker.recordFailure(migration, error, duration);
        throw error; // Stop executing remaining migrations
    }
}
```

### Step 6: State Recording

Tracker inserts record into `migrations` collection:

```typescript
// Success record
{
    migrationId: '003_assign_roles',
    status: 'completed',
    source: 'system',
    executedAt: new Date('2025-10-26T15:30:00Z'),
    executionDuration: 234, // milliseconds
    checksum: 'abc123...',
    environment: 'production',
    codebaseVersion: 'a04a2da...' // git commit hash
}

// Failure record
{
    migrationId: '004_broken_migration',
    status: 'failed',
    source: 'system',
    executedAt: new Date('2025-10-26T15:31:00Z'),
    executionDuration: 1543,
    error: 'Index creation failed: duplicate key error',
    errorStack: 'Error: Index creation failed...\n    at ...',
    checksum: 'def456...',
    environment: 'production',
    codebaseVersion: 'a04a2da...'
}
```

### Step 7: UI Display

Admin UI refreshes and displays updated state:

- **Pending count decrements** - Was 1, now 0 (if all succeeded)
- **Completed count increments** - Was 2, now 3
- **History table updates** - New row appears with execution details
- **Status badge changes** - Shows success (green) or failed (red)

## REST API Reference

All endpoints require admin authentication via `x-admin-token` header.

### GET /api/admin/migrations/status

Get comprehensive migration system status.

**Authentication:**
```http
x-admin-token: your-admin-token-here
```

**Response:**
```json
{
    "pending": [
        {
            "id": "003_assign_roles",
            "description": "Assign default roles to existing users",
            "source": "system",
            "filePath": "/apps/backend/src/services/database/migrations/003_assign_roles.ts",
            "timestamp": "2025-10-26T10:00:00.000Z",
            "dependencies": ["001_create_users", "002_create_roles"],
            "checksum": "abc123..."
        }
    ],
    "completed": ["001_create_users", "002_create_roles"],
    "isRunning": false,
    "totalPending": 1,
    "totalCompleted": 2
}
```

**Field descriptions:**

- `pending` - Array of migration metadata for migrations not yet executed
- `completed` - Array of migration IDs marked as completed in database
- `isRunning` - Boolean indicating if a migration is currently executing
- `totalPending` - Count of pending migrations
- `totalCompleted` - Count of completed migrations

**Usage example:**

```bash
curl -H "x-admin-token: $ADMIN_API_TOKEN" \
  http://localhost:4000/api/admin/migrations/status
```

### GET /api/admin/migrations/history

Get migration execution history with optional filtering.

**Authentication:**
```http
x-admin-token: your-admin-token-here
```

**Query parameters:**

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | number | 100 | 500 | Maximum number of records to return |
| `status` | string | 'all' | - | Filter by status ('all', 'completed', 'failed') |

**Response:**
```json
{
    "migrations": [
        {
            "migrationId": "002_create_roles",
            "status": "completed",
            "source": "system",
            "executedAt": "2025-10-26T14:30:00.000Z",
            "executionDuration": 123,
            "checksum": "def456...",
            "environment": "production",
            "codebaseVersion": "a04a2da..."
        },
        {
            "migrationId": "001_create_users",
            "status": "completed",
            "source": "system",
            "executedAt": "2025-10-26T14:29:00.000Z",
            "executionDuration": 234,
            "checksum": "abc123...",
            "environment": "production",
            "codebaseVersion": "a04a2da..."
        }
    ],
    "total": 2
}
```

**Field descriptions:**

- `migrationId` - Unique migration identifier
- `status` - Execution outcome ('completed' or 'failed')
- `source` - Source category (system, module:name, plugin:id)
- `executedAt` - ISO 8601 timestamp when migration executed
- `executionDuration` - Duration in milliseconds
- `error` - Error message (only present if status='failed')
- `errorStack` - Full stack trace (only present if status='failed')
- `checksum` - SHA-256 hash of migration file at execution time
- `environment` - NODE_ENV value when executed
- `codebaseVersion` - Git commit hash when executed (if available)

**Usage examples:**

```bash
# Get last 50 executions (all statuses)
curl -H "x-admin-token: $ADMIN_API_TOKEN" \
  "http://localhost:4000/api/admin/migrations/history?limit=50"

# Get only failed migrations
curl -H "x-admin-token: $ADMIN_API_TOKEN" \
  "http://localhost:4000/api/admin/migrations/history?status=failed"

# Get only completed migrations
curl -H "x-admin-token: $ADMIN_API_TOKEN" \
  "http://localhost:4000/api/admin/migrations/history?status=completed"
```

### POST /api/admin/migrations/execute

Execute specific migration or all pending migrations.

**Authentication:**
```http
x-admin-token: your-admin-token-here
Content-Type: application/json
```

**Request body (execute specific migration):**
```json
{
    "migrationId": "003_assign_roles"
}
```

**Request body (execute all pending):**
```json
{}
```

**Success response (200 OK):**
```json
{
    "success": true,
    "executed": ["003_assign_roles"]
}
```

**Success response (execute all, multiple migrations):**
```json
{
    "success": true,
    "executed": ["003_assign_roles", "004_add_indexes", "005_cleanup_legacy"]
}
```

**Failure response (500 Internal Server Error):**
```json
{
    "success": false,
    "executed": ["003_assign_roles", "004_add_indexes"],
    "failed": {
        "migrationId": "005_cleanup_legacy",
        "error": "Collection 'legacy_data' not found"
    }
}
```

**Conflict response (409 Conflict):**
```json
{
    "error": "Migration already running",
    "message": "Cannot execute migration: Another migration is already running"
}
```

**Not found response (404 Not Found):**
```json
{
    "error": "Migration not found",
    "message": "Migration '999_nonexistent' not found in pending migrations"
}
```

**Usage examples:**

```bash
# Execute all pending migrations
curl -X POST \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:4000/api/admin/migrations/execute

# Execute specific migration
curl -X POST \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"migrationId": "003_assign_roles"}' \
  http://localhost:4000/api/admin/migrations/execute
```

### GET /api/admin/migrations/:id

Get detailed information about a specific migration.

**Authentication:**
```http
x-admin-token: your-admin-token-here
```

**Response (pending migration):**
```json
{
    "migration": {
        "id": "003_assign_roles",
        "description": "Assign default roles to existing users",
        "source": "system",
        "filePath": "/apps/backend/src/services/database/migrations/003_assign_roles.ts",
        "timestamp": "2025-10-26T10:00:00.000Z",
        "dependencies": ["001_create_users", "002_create_roles"],
        "checksum": "abc123..."
    },
    "isPending": true,
    "executions": []
}
```

**Response (completed migration with history):**
```json
{
    "migration": null,
    "isPending": false,
    "executions": [
        {
            "migrationId": "001_create_users",
            "status": "completed",
            "source": "system",
            "executedAt": "2025-10-26T14:29:00.000Z",
            "executionDuration": 234,
            "checksum": "abc123...",
            "environment": "production",
            "codebaseVersion": "a04a2da..."
        }
    ]
}
```

**Not found response (404 Not Found):**
```json
{
    "error": "Migration not found",
    "message": "Migration '999_nonexistent' not found"
}
```

**Usage example:**

```bash
curl -H "x-admin-token: $ADMIN_API_TOKEN" \
  http://localhost:4000/api/admin/migrations/003_assign_roles
```

**For practical examples of using the database service API (createIndex, insertOne, updateMany, key-value storage), see [Migration Authoring Guide - Using the Database Service](../../apps/backend/src/services/database/migrations/README.md#using-the-database-service).**

## Admin UI Guide

The database migration admin interface is accessible at `/system/database` and requires admin authentication.

### Accessing the Dashboard

1. **Navigate to `/system`** in your browser
2. **Enter admin token** in the authentication modal (stored in localStorage)
3. **Click "Database" tab** in the system navigation menu
4. **View migration dashboard** with pending and completed sections

**Admin token location:**
Set `ADMIN_API_TOKEN` environment variable in `.env` file. Generate secure token with:
```bash
openssl rand -hex 32
```

### Dashboard Sections

**Header section:**
- **Database icon and title** - Identifies the page
- **Pending count** - Number of migrations not yet executed
- **Completed count** - Number of successfully executed migrations
- **Status indicator** - Badge showing "Running" (yellow) or "Ready" (green)
- **Execute All button** - Triggers batch execution of all pending migrations (disabled if none pending or already running)
- **Auto-refresh toggle** - Enables/disables automatic status polling every 5 seconds

**Pending migrations section:**
- **Grouped by source** - Expandable sections for system, modules, and plugins
- **Migration ID** - Unique identifier (e.g., `001_create_users`)
- **Description** - Human-readable explanation of migration purpose
- **Dependencies** - Badges showing required migrations (if any)
- **Execute button** - Runs individual migration (disabled if already running)

**Migration history section:**
- **Filter dropdowns** - Filter by status (all/completed/failed) and source (all/system/module/plugin)
- **Table columns** - Migration ID, Status badge, Executed At timestamp, Duration, Source badge, Error details
- **Error expansion** - Click "Show Error" button to reveal error message and stack trace
- **Chronological order** - Newest executions first

### Visual Status Indicators

**Status badges:**
- 🟢 **Green "Completed"** - Migration executed successfully
- 🔴 **Red "Failed"** - Migration failed with error (click "Show Error" to see details)
- 🟡 **Yellow "Running"** - Migration currently executing
- ⚪ **Gray "Ready"** - No migration currently running

**Source badges:**
- **"system"** - System migration from core infrastructure
- **"module:markets"** - Module migration from markets module
- **"plugin:whale-alerts"** - Plugin migration from whale-alerts plugin

### Common Operations

**Execute all pending migrations:**
1. Verify pending count is non-zero
2. Click "Execute All Pending" button
3. Watch status indicator change to "Running"
4. Wait for completion (status returns to "Ready")
5. Check history table for results

**Execute specific migration:**
1. Find migration in pending section
2. Click individual "Execute" button
3. Monitor status in history section
4. If failed, click "Show Error" to see details

**Filter migration history:**
1. Use status dropdown to show only completed or failed migrations
2. Use source dropdown to filter by system/module/plugin
3. Table updates immediately with filtered results

**View error details:**
1. Find failed migration in history table (red "Failed" badge)
2. Click "Show Error" button in Error column
3. Read error message and stack trace
4. Click "Hide" to collapse details

**Enable auto-refresh:**
1. Click "Auto-refresh Off" button to toggle on
2. Button changes to "Auto-refresh On"
3. Status section refreshes every 5 seconds
4. Click again to disable

## Troubleshooting

### Migration Not Discovered

**Symptom:** Migration file exists but doesn't appear in pending list.

**Diagnosis:**

- [ ] Check filename matches pattern: `\d{3}_[a-z0-9_-]+\.ts`
- [ ] Verify file is in correct location (system/modules/plugins)
- [ ] Check file exports `migration` object implementing `IMigration`
- [ ] Review backend logs for scanner warnings:
  ```bash
  tail -100 .run/backend.log | grep -i migration
  ```

**Common causes:**

```typescript
// Invalid filename (rejected by scanner)
1_create_users.ts              // Not enough leading zeros
001-create-users.ts            // Hyphen instead of underscore
001_CreateUsers.ts             // Uppercase letters

// Missing or wrong export
export const migrationConfig = { ... };  // Wrong export name
export default { ... };                  // Default export not supported

// Invalid structure
export const migration = {
    name: '001_create_users',  // Should be 'id' not 'name'
    description: '...',
    up: async (db) => { ... }  // Wrong parameter name
};
```

**Resolution:**

1. Fix filename to match pattern
2. Ensure `export const migration: IMigration = { ... }`
3. Rebuild backend: `./scripts/start.sh --force-build`
4. Check `/system/database` for migration in pending list

### Migration Fails During Execution

**Symptom:** Migration shows "Failed" status with error message in history.

**Diagnosis:**

- [ ] Click "Show Error" in admin UI to view error details
- [ ] Check backend logs for full context:
  ```bash
  tail -200 .run/backend.log | grep -A 20 "Migration failed"
  ```
- [ ] Verify dependencies completed successfully
- [ ] Check database state matches assumptions

**Common errors:**

**Collection not found:**
```typescript
// Error: Collection 'users' does not exist
await database.createIndex('users', { email: 1 });

// Fix: Ensure dependency creates collection first
dependencies: ['001_create_users_collection']
```

**Duplicate key error:**
```typescript
// Error: E11000 duplicate key error collection: tronrelic.users index: email_1
await database.insertOne('users', { email: 'admin@example.com' });

// Fix: Check for existence first (idempotent)
const existing = await database.findOne('users', { email: 'admin@example.com' });
if (!existing) {
    await database.insertOne('users', { email: 'admin@example.com' });
}
```

**Plugin collection restriction:**
```typescript
// Error: Plugin migrations can only access plugin-prefixed collections
await database.createIndex('users', { email: 1 });

// Fix: Use plugin-prefixed collection or key-value storage
await database.createIndex('subscriptions', { userId: 1 }); // Auto-prefixed
await database.set('config', { threshold: 1000000 }); // Scoped to plugin
```

**Transaction not supported:**
```typescript
// Warning: MongoDB transactions not supported (not a replica set)
// Migration executes without transaction protection

// If migration fails:
// Error: MIGRATION FAILED WITHOUT TRANSACTION SUPPORT - APPLICATION CANNOT CONTINUE SAFELY
// process.exit(1)

// Fix: Use MongoDB replica set deployment or write idempotent migrations
```

**Resolution:**

1. Review error message and stack trace
2. Fix migration code to address specific error
3. Rebuild backend: `./scripts/start.sh --force-build`
4. Retry execution via admin UI (failed migrations remain pending)

### Migration Running Forever

**Symptom:** Status shows "Running" for extended period (5+ minutes).

**Diagnosis:**

- [ ] Check backend logs for progress or errors:
  ```bash
  tail -f .run/backend.log | grep -i migration
  ```
- [ ] Verify backend process is still running:
  ```bash
  ps aux | grep node
  ```
- [ ] Check database connection is healthy:
  ```bash
  docker exec -it tronrelic-mongo mongosh tronrelic --eval "db.adminCommand('ping')"
  ```

**Common causes:**

- **Large data transformation** - Migration processing millions of documents
- **Network issues** - Database connection interrupted or slow
- **Deadlock** - Migration waiting for lock that never releases
- **Application crash** - Backend crashed but UI still shows "Running"

**Resolution:**

**If backend running normally:**
1. Wait for migration to complete (check logs for progress)
2. Consider optimizing migration for better performance

**If backend crashed:**
1. Restart backend: `./scripts/stop.sh && ./scripts/start.sh`
2. Check migration status in admin UI
3. If migration marked as failed, review error and retry
4. If migration marked as completed, verify database state

**If migration genuinely stuck:**
1. Restart backend: `./scripts/stop.sh && ./scripts/start.sh`
2. Review migration code for infinite loops or blocking operations
3. Fix code and rebuild
4. Retry execution

### Circular Dependency Detected

**Symptom:** Backend fails to start with error showing circular dependency path.

**Example error:**
```
Error: Circular dependency detected: A -> B -> C -> A. Remove one of these dependencies to break the cycle.
```

**Diagnosis:**

- [ ] Review error message for dependency cycle path
- [ ] Check migration `dependencies` arrays for cycles
- [ ] Visualize dependency graph on paper

**Example cycle:**

```typescript
// Migration A
export const migration: IMigration = {
    id: 'A',
    dependencies: ['B'],  // A depends on B
    // ...
};

// Migration B
export const migration: IMigration = {
    id: 'B',
    dependencies: ['C'],  // B depends on C
    // ...
};

// Migration C
export const migration: IMigration = {
    id: 'C',
    dependencies: ['A'],  // C depends on A ❌ CYCLE!
    // ...
};
```

**Resolution:**

1. Identify the cycle from error message
2. Determine which dependency is unnecessary
3. Remove one dependency to break the cycle
4. Rebuild backend

**Common pattern causing cycles:**

```typescript
// Both migrations depend on each other (mutual dependency)
export const migration: IMigration = {
    id: '001_create_users',
    dependencies: ['002_create_roles'],  // Users depend on roles
    // ...
};

export const migration: IMigration = {
    id: '002_create_roles',
    dependencies: ['001_create_users'],  // Roles depend on users ❌ CYCLE!
    // ...
};

// Fix: Remove one dependency or create intermediate migration
export const migration: IMigration = {
    id: '001_create_users',
    dependencies: [],  // No dependencies
    // ...
};

export const migration: IMigration = {
    id: '002_create_roles',
    dependencies: ['001_create_users'],  // Only roles depend on users ✅
    // ...
};
```

### Dependency Not Found

**Symptom:** Backend fails to start with error about missing dependency.

**Example error:**
```
Error: Migration '003_assign_roles' depends on '999_nonexistent', but that migration was not found. Ensure the dependency exists or remove it from the dependencies array.
```

**Diagnosis:**

- [ ] Verify dependency migration file exists in filesystem
- [ ] Check dependency ID matches filename exactly
- [ ] Ensure dependency file is valid (not skipped during scan)

**Common causes:**

```typescript
// Typo in dependency ID
dependencies: ['001_create_user']  // Missing 's' - should be 'create_users'

// Wrong source prefix
dependencies: ['plugin:whale-alerts:001_config']  // Should be just '001_config'

// Dependency file doesn't exist
dependencies: ['999_nonexistent']

// Dependency file invalid (skipped by scanner)
dependencies: ['001_CreateUsers']  // Uppercase - file rejected by scanner
```

**Resolution:**

1. Verify dependency file exists and has valid filename
2. Correct dependency ID in migration's `dependencies` array
3. Rebuild backend

### Transaction Rollback Failed

**Symptom:** Application crashes with fatal error after migration failure.

**Example error:**
```
FATAL: Migration transaction rollback failed - data may be corrupted
process.exit(1)
```

**This is a critical error indicating potential data corruption.**

**Diagnosis:**

- [ ] Check backend logs for transaction error details
- [ ] Verify MongoDB replica set is healthy
- [ ] Check database connection stability

**Immediate actions:**

1. **Do not restart the application** until database state is verified
2. **Connect to MongoDB** and inspect affected collections:
   ```bash
   docker exec -it tronrelic-mongo mongosh tronrelic
   > db.migrations.find({ status: 'failed' }).sort({ executedAt: -1 }).limit(1)
   ```
3. **Review migration code** to understand what changes were attempted
4. **Manually verify database state** - check if partial changes were applied

**Recovery:**

**If database state is consistent:**
1. Mark migration as failed manually (if not already):
   ```javascript
   db.migrations.insertOne({
       migrationId: '003_broken_migration',
       status: 'failed',
       error: 'Transaction rollback failed',
       executedAt: new Date()
   });
   ```
2. Fix migration code
3. Rebuild and restart backend
4. Retry migration

**If database state is corrupted:**
1. Restore from backup (if available)
2. Replay migrations up to the failure point
3. Fix broken migration
4. Continue from restored state

**Prevention:**

- Use MongoDB replica set for transaction support
- Write idempotent migrations (safe to run multiple times)
- Test migrations against realistic datasets before production
- Maintain regular database backups

## Further Reading

**Migration authoring:**
- [Migration Authoring Guide](../../apps/backend/src/services/database/migrations/README.md) - Complete developer guide for writing migrations (naming conventions, dependencies, idempotency, common patterns, database API usage)
- [Migration Examples](./migration-examples/) - System, module, and plugin migration examples with detailed comments

**Interface contracts:**
- [IMigration Interface](../../packages/types/src/database/IMigration.ts) - Migration contract with detailed JSDoc
- [IDatabaseService Interface](../../packages/types/src/database/IDatabaseService.ts) - Database service API reference

**Related topics:**
- [system-scheduler-operations.md](./system-scheduler-operations.md) - How scheduler jobs work (similar control patterns)
- [system-testing.md](./system-testing.md) - Testing framework for database services
- [system-database.md](./system-database.md) - Database access architecture
- [environment.md](../environment.md) - `ADMIN_API_TOKEN` configuration
