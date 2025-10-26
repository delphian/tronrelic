# IDatabaseService Refactoring Implementation Plan

## Overview
Refactor `IPluginDatabase` → `IDatabaseService` to provide a unified database abstraction across the entire application while maintaining Mongoose integration for services that need schema validation and type safety.

## Goals
1. Rename `IPluginDatabase` → `IDatabaseService` in `@tronrelic/types`
2. Create `DatabaseService` implementation that supports both Mongoose models and raw collections
3. Maintain backward compatibility for plugins
4. Refactor all services to use dependency injection with `IDatabaseService`
5. Preserve Mongoose benefits (validation, type safety, defaults) where needed

## Architecture

### Three-Tier Database Access Pattern

**Tier 1: Raw MongoDB Collections**
- Direct access to MongoDB native driver collections
- Use case: Plugins, simple CRUD operations, maximum flexibility
- API: `getCollection<T>(name: string): Collection<T>`

**Tier 2: Mongoose Model Registry**
- Optional Mongoose model registration for complex entities
- Use case: Entities requiring validation, hooks, virtuals, defaults
- API: `registerModel(name, model)`, `getModel(name)`

**Tier 3: Convenience Methods**
- Smart methods that prefer Mongoose models when available
- Fallback to raw collections if no model registered
- API: `find()`, `findOne()`, `insertOne()`, etc.

### Collection Namespacing

**Core Services**: No prefix
- Collections: `system_config`, `transactions`, `blocks`, etc.

**Plugins**: Automatic `plugin_{id}_` prefix
- Collections: `plugin_whale-alerts_subscriptions`, etc.

## Implementation Phases

### Phase 1: Core Interface & Implementation

**Files to create/modify:**
1. `packages/types/src/database/IDatabaseService.ts` (new)
2. `apps/backend/src/services/database.service.ts` (new)
3. `packages/types/src/index.ts` (export new interface)

**Changes:**
- Create `IDatabaseService` interface with Mongoose model support
- Implement `DatabaseService` class with:
  - Mongoose connection wrapper
  - Model registry (Map<string, Model>)
  - Collection name prefixing logic
  - Smart convenience methods (prefer models, fallback to raw)

### Phase 2: Plugin Compatibility Layer

**Files to modify:**
1. `apps/backend/src/services/plugin-database.service.ts`
2. `packages/types/src/plugin/IPluginDatabase.ts`

**Changes:**
- Make `PluginDatabaseService` extend `DatabaseService` with prefix
- Add type alias: `export type IPluginDatabase = IDatabaseService`
- Update JSDoc to indicate deprecation path

### Phase 3: Service Migration

**Services to refactor (priority order):**

1. **SystemConfigService** (simple, good test case)
   - Add database dependency injection
   - Register `SystemConfigModel` with database service
   - Use model-based methods instead of direct Mongoose calls

2. **MenuService** (already uses injected database)
   - Change type from `IPluginDatabase` → `IDatabaseService`
   - No prefix needed for core service

3. **SystemLogService** (uses Mongoose model)
   - Add database injection
   - Register `SystemLogModel`

4. **All other services** (bulk update)
   - Update imports: `IPluginDatabase` → `IDatabaseService`
   - Verify no breaking changes

### Phase 4: Bootstrap & Context Updates

**Files to modify:**
1. `apps/backend/src/index.ts` (bootstrap)
2. `apps/backend/src/services/plugin.service.ts` (plugin context)
3. `packages/types/src/plugin/IPluginContext.ts`

**Changes:**
- Initialize global `DatabaseService` singleton
- Update plugin context to provide `IDatabaseService`
- Ensure proper initialization order

### Phase 5: Testing & Documentation

**Testing:**
- Build all workspaces
- Run existing unit tests
- Verify no TypeScript errors
- Test plugin initialization

**Documentation:**
- Update TODO.md (mark as complete)
- Create migration guide for plugin authors
- Update service documentation

## Detailed File Changes

### 1. Create IDatabaseService Interface

**File:** `packages/types/src/database/IDatabaseService.ts`

```typescript
import type { Collection, Document, Filter, UpdateFilter, IndexDescription, Model } from 'mongodb';

export interface IDatabaseService {
    // Tier 1: Raw collection access
    getCollection<T extends Document = Document>(name: string): Collection<T>;

    // Tier 2: Mongoose model registry
    registerModel<T extends Document = Document>(collectionName: string, model: any): void;
    getModel<T extends Document = Document>(collectionName: string): any | undefined;

    // Tier 3: Convenience methods
    get<T = any>(key: string): Promise<T | undefined>;
    set<T = any>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;

    createIndex(
        collectionName: string,
        indexSpec: IndexDescription,
        options?: { unique?: boolean; sparse?: boolean; expireAfterSeconds?: number }
    ): Promise<void>;

    count<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number>;

    find<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>,
        options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> }
    ): Promise<T[]>;

    findOne<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<T | null>;

    insertOne<T extends Document = Document>(
        collectionName: string,
        document: T
    ): Promise<any>;

    updateMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>,
        update: UpdateFilter<T>
    ): Promise<number>;

    deleteMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number>;
}
```

### 2. Implement DatabaseService

**File:** `apps/backend/src/services/database.service.ts`

- Merge logic from `PluginDatabaseService`
- Add model registry
- Add smart convenience methods
- Support optional collection prefixing

### 3. Update PluginDatabaseService

**File:** `apps/backend/src/services/plugin-database.service.ts`

```typescript
export class PluginDatabaseService extends DatabaseService {
    constructor(pluginId: string) {
        super({ prefix: `plugin_${pluginId}_` });
    }
}
```

### 4. Add Type Alias

**File:** `packages/types/src/plugin/IPluginDatabase.ts`

```typescript
import type { IDatabaseService } from '../database/IDatabaseService.js';

/**
 * @deprecated Use IDatabaseService instead.
 * This type alias exists for backward compatibility.
 */
export type IPluginDatabase = IDatabaseService;
```

## Migration Examples

### Before (SystemConfigService)
```typescript
export class SystemConfigService {
    async getConfig(): Promise<ISystemConfig> {
        let config = await SystemConfigModel.findOne({ key: 'system' });
        // ...
    }
}
```

### After (SystemConfigService)
```typescript
export class SystemConfigService {
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {
        // Register Mongoose model
        this.database.registerModel('system_config', SystemConfigModel);
    }

    async getConfig(): Promise<ISystemConfig> {
        // Use convenience method (automatically uses registered model)
        const config = await this.database.findOne<SystemConfigDoc>(
            'system_config',
            { key: 'system' }
        );
        // ...
    }
}
```

## Rollback Plan

If issues arise:
1. Revert commits in reverse order (Phase 5 → Phase 1)
2. Type alias ensures plugins continue working
3. No database schema changes (safe to rollback)

## Success Criteria

- ✅ All TypeScript compilation succeeds
- ✅ All existing tests pass
- ✅ Plugins continue to function
- ✅ Services use dependency injection
- ✅ Mongoose benefits preserved where needed
- ✅ Documentation updated

## Timeline Estimate

- Phase 1: 30 minutes (interface + core implementation)
- Phase 2: 15 minutes (plugin compatibility)
- Phase 3: 45 minutes (service migration)
- Phase 4: 20 minutes (bootstrap updates)
- Phase 5: 30 minutes (testing + docs)

**Total: ~2.5 hours for complete refactoring**
