# Source-Independent Domain Types

The `@delphian/tronrelic-types` package is a contract surface, not a dumping ground for whatever shape a value happens to have in transit. A type earns a place there only if it describes a domain fact that any data source must satisfy — independent of which database stores it or which provider supplied it.

## Why This Matters

A return type that leaks its source couples every consumer to that source. The failure is silent: an `any` or an open `Record<string, unknown>` stores fine in MongoDB, MySQL, or ClickHouse alike, so nothing breaks at the storage layer — but the *meaning* of those bytes is dictated by whoever filled them. The moment the source changes (a new block provider, a columnar mirror, a different store), the field holds differently-shaped data or nothing, and because the type declared no contract, the compiler warns no one. Consumers break at runtime.

The defect is never "this engine can't hold the value." It is that the type delegates meaning to the source instead of obligating the source to a meaning. A field like `amountSun: number` is source-independent — every backend is obligated to produce a number. A field like `info: any` is the opposite — it imposes no obligation, so its contents default to the current pipeline's native shape. That is source coupling achieved through a type that looks source-agnostic.

`IBlockTransaction` exists because the path that started it — mapping a memo's `txId` to its block — kept colliding with `ITransaction`, the observer-delivery envelope whose `rawValue`, `info`, and `snapshot` members are raw TronGrid and Socket.IO artifacts. The envelope is correct for observers; it is wrong as a read contract.

## How It Works

The package holds domain contracts. Core (`src/shared`, `src/backend`) holds implementation and pipeline artifacts. Persistence shapes (`TronTransactionDocument`), provider wire structs (`TronGridBlock`), and delivery envelopes (`ITransaction`) stay in core because they describe *how a layer works*, not *what a transaction is*.

Apply one admission test before adding a type — or a field — to the package:

> Could a MySQL or ClickHouse backend, fed by a non-TronGrid provider, populate every field by obligation, with no `any` and no provider envelope?

If yes, it belongs. If a field can only be filled by replaying the current source's native structure, it is an enrichment or a pipeline artifact — model it elsewhere, or mark it optional only when a bare provider can honestly omit it. An open `Record<string, unknown>` is admissible only when the *domain* is genuinely open (decoded ABI arguments, identical across any decoder), never as a stand-in for an un-modeled provider blob.

Canonical examples already in the package: `IBlock` and `IBlockTransaction`. Both are flat projections of on-chain facts with a service-side mapper from the storage document.

### Known Debt (Do Not Copy)

These predate the rule and violate it. They are migration targets, not precedent:

| Type | Location | Problem |
|---|---|---|
| `ITransaction` | `packages/types/src/transaction/` | Observer envelope in the contract package; `rawValue`/`info`/`snapshot` are provider/transport artifacts. Legitimate for observers, never as a read contract. |
| `TronTransactionDocument` | `src/shared/types/` | Mongo persistence shape; correctly in core, but referenced where a domain type belongs. |

## Example

```typescript
// CORRECT — every field is an on-chain fact the source must satisfy
export interface IResourceUsage {
    consumed: number; // net_usage or energy_usage — units the chain recorded
    feeSun: number;   // net_fee or energy_fee — TRX burned, in sun
}

// WRONG — pipeline envelope; meaning supplied by the source, not the contract
export interface ITransaction {
    rawValue: Record<string, unknown>; // raw TronGrid contract params
    info: any;                         // provider-varying receipt
    snapshot: any;                     // Socket.IO frame
}
```

## Further Reading

**Detailed documentation:**
- [system-block-provider-migration.md](./system-block-provider-migration.md) - The same decoupling thesis at the ingestion layer: a provider-neutral `IBlockProvider` behind the sync pipeline. Source-independent types are its contract-layer complement.
- [system-database.md](./system-database.md) - `IDatabaseService` abstraction and why persistence shapes stay in core.

**Related topics:**
- [modules.md](./modules/modules.md) - Service interface conventions (`IXxxService`) that return these contracts.
- [documentation.md](../documentation.md) - Documentation standards.
