# Testing Framework

TronRelic uses Vitest for unit testing with comprehensive Mongoose mocking utilities that enable full database service testing without requiring a live MongoDB instance.

## Who This Document Is For

Backend developers writing unit tests for database services, plugin authors testing plugin storage implementations, and maintainers ensuring test coverage for IDatabaseService implementations.

## Why This Matters

Testing database logic without real MongoDB provides:

- **Faster test execution** - No network overhead or database startup time
- **Isolated test environments** - Each test runs with clean state, no cross-test interference
- **Error injection capabilities** - Simulate database failures to validate error handling
- **CI/CD compatibility** - No external dependencies required for automated testing

Without proper mocking infrastructure:

- Tests require MongoDB containers (slow startup, resource-intensive)
- Test isolation is difficult (shared database state causes flaky tests)
- Error scenarios are hard to reproduce (database failures are non-deterministic)
- CI/CD pipelines need additional infrastructure complexity

## Vitest Test Runner

TronRelic uses [Vitest](https://vitest.dev/) as the test framework for all unit tests. Key features:

- **Compatible with Jest API** - Uses familiar `describe()`, `it()`, `expect()` syntax
- **Fast execution** - Vite-powered with native ESM support
- **Built-in mocking** - `vi.mock()` and `vi.fn()` for dependency injection
- **Watch mode** - Run tests on file changes during development

**Run tests:**
```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Specific test file
npm test -- src/services/database/__tests__/database.service.test.ts
```

## Mongoose Mocking System

The shared Mongoose mocking utilities provide complete mock implementations of:

- **MongoDB collections** - CRUD operations with chainable query builders
- **Mongoose models** - Model registry with lean queries and hooks
- **Query builders** - Full support for `find().sort().skip().limit()` chains
- **Error injection** - Simulate database failures for testing error paths

**Location:** `/home/delphian/projects/tronrelic.com-beta/apps/backend/src/tests/vitest/mocks/mongoose.ts`

## Quick Start Example

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockMongooseModule, clearMockCollections, getMockCollections } from '../../../tests/vitest/mocks/mongoose.js';

// Mock mongoose module BEFORE importing services
vi.mock('mongoose', async (importOriginal) => {
    const { createMockMongooseModule } = await import('../../../tests/vitest/mocks/mongoose.js');
    return createMockMongooseModule()(importOriginal);
});

// Import service AFTER mocking dependencies
import { DatabaseService } from '../database.service.js';

describe('MyDatabaseService', () => {
    let service: DatabaseService;

    beforeEach(() => {
        clearMockCollections();
        service = new DatabaseService();
    });

    it('should store key-value data', async () => {
        await service.set('config-key', 'config-value');

        const collections = getMockCollections();
        const kvData = collections.get('_kv');

        expect(kvData).toHaveLength(1);
        expect(kvData[0]).toMatchObject({
            key: 'config-key',
            value: 'config-value'
        });
    });

    it('should retrieve stored values', async () => {
        await service.set('user-name', 'Alice');
        const result = await service.get('user-name');

        expect(result).toBe('Alice');
    });
});
```

## Available Mock Helpers

**Collection Management:**
- `clearMockCollections()` - Clear all mock data (use in `beforeEach`)
- `getMockCollections()` - Access underlying data for assertions
- `createMockCollectionWithData(name, docs)` - Pre-populate test fixtures

**Error Injection:**
- `injectCollectionError(collection, operation, error)` - Force operation failures

**Spying:**
- `spyOnCollectionOperation(collection, operation)` - Verify operation calls

**See the source file for complete API documentation:** [mongoose.ts](../../apps/backend/src/tests/vitest/mocks/mongoose.ts)

## Supported MongoDB Operations

The mock system supports all common MongoDB operations:

**Queries:**
- `find()` with filtering, sorting, skip, limit
- `findOne()` with ObjectId and equality matching
- `countDocuments()` with filter support

**Mutations:**
- `insertOne()` with automatic `_id` generation
- `updateOne()` with upsert support
- `updateMany()` with filter matching
- `deleteOne()` and `deleteMany()`

**Indexes:**
- `createIndex()` (no-op but tracked)

**Mongoose-specific:**
- `Model.create()` with hooks
- `.lean()` queries for performance
- `.exec()` query materialization

## Common Testing Patterns

**Testing error handling:**
```typescript
it('should handle database errors gracefully', async () => {
    injectCollectionError('users', 'findOne', new Error('Connection lost'));

    await expect(service.getUser('123'))
        .rejects
        .toThrow('Connection lost');
});
```

**Verifying operation calls:**
```typescript
it('should create index on collection', async () => {
    const spy = spyOnCollectionOperation('users', 'createIndex');

    await service.ensureIndexes();

    expect(spy).toHaveBeenCalledWith({ email: 1 });
});
```

**Testing with pre-populated data:**
```typescript
beforeEach(() => {
    createMockCollectionWithData('users', [
        { _id: new ObjectId(), name: 'Alice', role: 'admin' },
        { _id: new ObjectId(), name: 'Bob', role: 'user' }
    ]);
});

it('should find admin users', async () => {
    const admins = await service.findUsers({ role: 'admin' });

    expect(admins).toHaveLength(1);
    expect(admins[0].name).toBe('Alice');
});
```

## Real-World Usage

**Complete test files using the mock system:**
- [database.service.test.ts](../../apps/backend/src/services/database/__tests__/database.service.test.ts) - 37 tests covering all IDatabaseService operations
- [plugin-database.service.test.ts](../../apps/backend/src/services/database/__tests__/plugin-database.service.test.ts) - 25 tests validating plugin storage isolation

These files demonstrate:
- Proper mock setup and teardown
- Testing CRUD operations with assertions
- Error injection for failure paths
- Verifying collection prefixing for plugin isolation
- Testing chainable query builders

## Pre-Test Checklist

Before writing new database service tests:

- [ ] Import mock helpers from `../../../tests/vitest/mocks/mongoose.js`
- [ ] Call `vi.mock('mongoose', ...)` BEFORE importing services
- [ ] Call `clearMockCollections()` in `beforeEach()` for test isolation
- [ ] Use `getMockCollections()` for direct data assertions
- [ ] Test error paths using `injectCollectionError()`
- [ ] Verify all MongoDB operations are covered by test cases
- [ ] Run tests with `npm test` to ensure 100% pass rate

## Further Reading

**Mock implementation:**
- [mongoose.ts](../../apps/backend/src/tests/vitest/mocks/mongoose.ts) - Complete API reference and implementation details

**Related topics:**
- [plugins-database.md](../plugins/plugins-database.md) - Plugin database storage patterns and IPluginDatabase usage
- [system.md](./system.md) - System architecture overview
