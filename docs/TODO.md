# TronRelic TODO

## Implement Centralized Database Migration System

TronRelic currently lacks a centralized way to track and apply required database schema changes. When code removes features (like the recent chat and comment system removal), orphaned MongoDB collections remain in the database with no systematic cleanup mechanism. This creates inconsistencies across environments (dev, staging, production) and makes deployments risky since there's no audit trail of what database changes were applied or when.

Implement a TypeScript-based migration system in `apps/backend/src/migrations/` that runs automatically on application startup. Each migration should be a timestamped TypeScript file (e.g., `001-drop-chat-collections.ts`) that uses existing Mongoose models and the dependency injection system. The system should track which migrations have been applied by storing records in a `migration_history` MongoDB collection, preventing duplicate executions and allowing rollback capability. This approach integrates seamlessly with the backend's existing architecture, leverages the logger for audit trails, and eliminates the need for manual database maintenance scripts.

## ✅ COMPLETED: Centralized Error and Warning Logging to MongoDB

**Status:** Implemented and deployed

**Implementation:** System logs feature has been fully implemented with the following components:

1. **MongoDB Schema** - `apps/backend/src/database/models/SystemLog.ts`
2. **SystemLogsService** - `apps/backend/src/services/system-logs/system-logs.service.ts`
3. **Admin API Endpoints** - Added to `apps/backend/src/api/routes/system.router.ts`
4. **System Config** - `systemLogsMaxCount` and `systemLogsRetentionDays` settings
5. **Scheduler Job** - `system-logs:cleanup` runs hourly
6. **Frontend UI** - `/system/logs` page with filtering, pagination, and live polling

**TECHNICAL DEBT - Refactor Logger Monkey Patching:**

The current implementation uses **monkey patching** to intercept Pino logger calls:

```typescript
// apps/backend/src/services/system-logs/system-logs.service.ts (line 159-182)
const originalError = logger.error.bind(logger);
const originalWarn = logger.warn.bind(logger);

(logger as any).error = function(this: any, ...args: any[]) {
    (originalError as any)(...args);
    void SystemLogsService.getInstance().saveLogFromArgs('error', args);
};
```

**Why this is technical debt:**
- Modifies the logger object at runtime (hidden behavior)
- Uses `as any` to bypass TypeScript type safety
- Makes debugging harder (stack traces may be confusing)
- Difficult to discover for developers unfamiliar with the codebase

**Proposed refactoring approaches:**

**Option 1: Pino Custom Transport (Preferred)**
Move logger initialization to happen after database connection, allowing proper Pino transport configuration:
```typescript
// Refactor lib/logger.ts to be a factory function
export function createLogger(mongoTransport?: pino.DestinationStream) {
    const targets = [
        { target: 'pino/file', ... },
        { target: 'pino-pretty', ... }
    ];

    if (mongoTransport) {
        targets.push({ stream: mongoTransport });
    }

    return pino({ ... }, pino.transport({ targets }));
}

// In index.ts after database connection
import { createLogger } from './lib/logger.js';
const mongoStream = createMongoDBStream();
export const logger = createLogger(mongoStream);
```

**Option 2: Pino Middleware Hook**
Use Pino's `mixin` or custom serializer to intercept logs:
```typescript
const logger = pino({
    mixin() {
        return { /* intercept here */ };
    }
});
```

**Option 3: Wrapper Logger Class**
Create a `DatabaseLogger` class that wraps Pino and is injected via dependency injection (more invasive, requires changing all imports).

**Implementation requirements:**
- Must initialize after database connection
- Must not break existing child loggers
- Must maintain backward compatibility with plugin logs
- Should preserve type safety
- Must handle initialization order correctly

**Benefits of refactoring:**
- Type-safe implementation
- More discoverable behavior
- Easier to test and mock
- Clearer dependency chain
- Follows Pino best practices

## Refactor IPluginDatabase to IDatabaseService

The current `IPluginDatabase` interface is specifically named and designed for plugin usage, but its functionality is generic enough to be useful across the entire application. Services like `SystemConfigService` and others could benefit from a standardized database abstraction layer rather than using Mongoose models directly.

**Current State:**
- `IPluginDatabase` provides a clean abstraction over MongoDB collections with scoped namespacing
- Currently only used by plugins through `PluginDatabaseService`
- Other services (like `SystemConfigService`) use Mongoose models directly, making them harder to test
- Testing requires mocking Mongoose at a low level or using real MongoDB connections

**Proposed Refactoring:**

1. **Rename and generalize the interface:**
   - Rename `IPluginDatabase` → `IDatabaseService`
   - Keep plugin-specific implementation as `PluginDatabaseService` (extends/implements `IDatabaseService` with namespace prefixing)
   - Create a new `DatabaseService` class for general-purpose usage (no namespace prefixing)

2. **Update type definitions:**
   - Move `IDatabaseService` to `@tronrelic/types` as a generic database abstraction
   - Keep plugin-specific behavior in plugin types (namespace prefixing, scoped collections)
   - Ensure backward compatibility with existing plugin code

3. **Refactor services to use IDatabaseService:**
   - Update `SystemConfigService` to accept `IDatabaseService` via dependency injection
   - Update `MenuService` (already uses injected database, just needs type rename)
   - Update other services that directly use Mongoose models where appropriate

4. **Improve testability:**
   - Create `MockDatabaseService` test helper (similar to `MockPluginDatabase` in menu tests)
   - Update existing tests to use mock database service instead of mocking Mongoose
   - Make it easy to test services without requiring real MongoDB connections

**Benefits:**
- Consistent database abstraction across the entire application
- Improved testability - services can use mock database implementations
- Dependency injection enables better separation of concerns
- Plugin database behavior remains unchanged (still uses namespace prefixing)
- Other services gain the same clean API plugins already enjoy

**Implementation Notes:**
- Ensure backward compatibility - existing plugins should continue working without changes
- Update all type imports across the codebase (`IPluginDatabase` → `IDatabaseService`)
- Add migration guide to documentation for plugin authors
- Update `SystemConfigService` tests to use `MockDatabaseService` instead of mocking Mongoose