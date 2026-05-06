# Testing Framework

TronRelic uses Vitest with shared mock implementations of MongoDB/Mongoose, the filesystem, and core services so every unit test runs in isolation — no live database, no disk, no network.

## Why This Matters

Without these shared mocks, service tests either spin up MongoDB/filesystem fixtures (slow, flaky in CI) or each suite re-implements its own mocks (inconsistent, easy to drift). The repo provides one canonical set of mocks; every test imports from the same `src/backend/tests/vitest/mocks/` directory.

## Vitest

Familiar Jest-style API (`describe`, `it`, `expect`), Vite-native ESM, `vi.mock()` for hoisted module mocks. Run `npm test` for the full suite, `npm test -- <path>` for a single file, `npm test -- --watch` while iterating.

## Available Mocks

All under `src/backend/tests/vitest/mocks/`:

| Mock file | Purpose | Key exports |
|---|---|---|
| `mongoose.ts` | Replaces the `mongoose` module with in-memory collections + chainable queries | `createMockMongooseModule`, `clearMockCollections`, `getMockCollections`, `createMockCollectionWithData`, `injectCollectionError`, `spyOnCollectionOperation` |
| `fs.ts` | Replaces `fs/promises` with an in-memory filesystem (proper ENOENT codes) | `createMockFsModule`, `clearMockFilesystem`, `setMockFile`, `setMockDirectory`, `removeMockPath`, `mockPathExists`, `getMockPaths` |
| `database-service.ts` | Mock `IDatabaseService` for tests that consume the abstraction directly | `createMockDatabaseService` |
| `service-registry.ts` | Mock `IServiceRegistry` for tests that look up services by name | `createMockServiceRegistry(seed?)` |
| `chain-parameters.ts` | Mock chain parameters (energyPerTrx, energyFee) and full plugin context | `createMockChainParameters`, `createMockContextWithChainParameters` |

For most service tests, prefer `createMockDatabaseService()` over the raw `mongoose.ts` mock — it's faster and matches how production code consumes `IDatabaseService` via DI. The Mongoose mock is for exercising `DatabaseService` itself or anything that has not yet migrated to the abstraction.

## Hoisting Trap

`vi.mock('mongoose', ...)` and `vi.mock('fs/promises', ...)` **must run before any import that pulls those modules transitively**. Vitest hoists `vi.mock` calls to the top of the file, but you still need to dynamic-import the mock factory to avoid module-resolution cycles. Pattern:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMockCollections, getMockCollections } from '../../../tests/vitest/mocks/mongoose.js';

vi.mock('mongoose', async (importOriginal) => {
    const { createMockMongooseModule } = await import('../../../tests/vitest/mocks/mongoose.js');
    return createMockMongooseModule()(importOriginal);
});

import { DatabaseService } from '../database.service.js';
```

The same shape applies for `fs/promises`:

```typescript
vi.mock('fs/promises', () => createMockFsModule()());
```

Forgetting this order is the most common cause of "real Mongo connection attempt during test" errors.

## Quick Patterns

**Reset between tests:**

```typescript
beforeEach(() => {
    clearMockCollections();
    clearMockFilesystem();
});
```

**Pre-populate fixtures:**

```typescript
createMockCollectionWithData('users', [
    { _id: new ObjectId(), name: 'Alice', role: 'admin' },
    { _id: new ObjectId(), name: 'Bob', role: 'user' }
]);
```

**Inject a failure to exercise the error path:**

```typescript
injectCollectionError('users', 'findOne', new Error('Connection lost'));
await expect(service.getUser('123')).rejects.toThrow('Connection lost');
```

**Spy on a specific operation:**

```typescript
const spy = spyOnCollectionOperation('users', 'createIndex');
await service.ensureIndexes();
expect(spy).toHaveBeenCalledWith({ email: 1 });
```

**Assert via the underlying store:**

```typescript
await service.set('config-key', 'config-value');
const kv = getMockCollections().get('_kv');
expect(kv).toHaveLength(1);
expect(kv[0]).toMatchObject({ key: 'config-key', value: 'config-value' });
```

## Supported MongoDB Operations

- Queries: `find()` (filtering, sort, skip, limit chains), `findOne()` (ObjectId + equality), `countDocuments()`
- Mutations: `insertOne()` (auto-generates `_id`), `updateOne()` (with upsert), `updateMany()`, `deleteOne()`, `deleteMany()`
- Indexes: `createIndex()` (no-op but tracked, so spies work)
- Mongoose-specific: `Model.create()` with hooks, `.lean()`, `.exec()` materialization

## Reference Implementations

Real test files exercising the mock system:

- `src/backend/modules/database/__tests__/database.service.test.ts` — exhaustive `IDatabaseService` operation coverage including key-value, three-tier access, and error paths
- `src/backend/modules/database/__tests__/plugin-database.service.test.ts` — plugin namespace isolation, prefixed collection names

## Further Reading

- [system-database.md](./system-database.md) — `IDatabaseService` design that the mock implements
- Source: `src/backend/tests/vitest/mocks/` (every file is exported via the index — JSDoc on each export)
