# Blockchain

Owns TRON block retrieval and persistence: `TronGridClient` pulls blocks, `transaction-parse.ts` decodes embedded contracts, and `BlockchainService` enriches transactions and notifies observers before writing to MongoDB.

## External provider clients

`TronGridClient` (`tron-grid.client.ts`) is the platform's TronGrid transport: block pulls, account transactions (native / TRC20 / internal), and `getActivatingTransaction()` — which resolves the account that activated an address from its oldest transaction, validating a candidate against the account's `create_time` so an internally-activated account returns null instead of a false edge (up to two calls per ancestor-climb step). The guard tolerates a one-block (~3000 ms) skew because `create_time` trails the activating tx's confirmed `block_timestamp` by exactly one block even for a genuine activation (`ACTIVATION_CREATE_TIME_SKEW_MS`); a strict comparison would misreport every ordinary wallet as its own origin. Every method shares one rotating-key, 200ms-throttled request queue with live block sync.

`BlockchainService.climbActivationAncestry()` (published on `IBlockchainService`) is the whole-ladder counterpart: it walks `getActivatingTransaction` from an address toward its origin — bounded by `MAX_ACTIVATION_ANCESTRY_DEPTH` (20), cycle-guarded — with an optional per-hop streaming callback and a shared edge cache so a batch of addresses fetches common tails once. The Address Origins tool and plugin discovery-provenance both consume it, so the bounded loop lives here once rather than being re-implemented per caller.

A sibling transport, `TronScanClient`, lives in the [providers module](../providers/README.md) — a distinct provider with its own base URL, key, and rate budget, currently backing the local TRX price series. Reach for TronGrid for chain and account data; use TronScan only where no TronGrid path exists.

## Canonical documentation

- [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md) — block retrieval, enrichment pipeline, observer dispatch
- [plugins-blockchain-observers.md](../../../../docs/plugins/plugins-blockchain-observers.md) — building observers that react to transactions this module notifies
