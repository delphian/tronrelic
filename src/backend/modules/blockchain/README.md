# Blockchain

Owns TRON block retrieval and persistence: `TronGridClient` pulls blocks, `transaction-parse.ts` decodes embedded contracts, and `BlockchainService` enriches transactions and notifies observers before writing to MongoDB.

## External provider clients

`TronGridClient` (`tron-grid.client.ts`) is the platform's TronGrid transport: block pulls, account transactions (native / TRC20 / internal), and `getActivatingTransaction()` — which resolves the account that activated an address from its oldest transaction, validating a candidate against the account's `create_time` so an internally-activated account returns null instead of a false edge (up to two calls per ancestor-climb step). Every method shares one rotating-key, 200ms-throttled request queue with live block sync.

A sibling transport, `TronScanClient`, lives in the [providers module](../providers/README.md) — a distinct provider with its own base URL, key, and rate budget, currently backing the local TRX price series. Reach for TronGrid for chain and account data; use TronScan only where no TronGrid path exists.

## Canonical documentation

- [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md) — block retrieval, enrichment pipeline, observer dispatch
- [plugins-blockchain-observers.md](../../../../docs/plugins/plugins-blockchain-observers.md) — building observers that react to transactions this module notifies
