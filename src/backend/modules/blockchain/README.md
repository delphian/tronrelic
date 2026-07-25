# Blockchain

Owns TRON block retrieval and persistence: `TronGridClient` pulls blocks, `transaction-parse.ts` decodes embedded contracts, and `BlockchainService` enriches transactions and notifies observers before writing to MongoDB.

## External provider clients

`TronGridClient` (`tron-grid.client.ts`) is the platform's TronGrid transport: block pulls, account transactions (native / TRC20 / internal), and `getActivatingTransaction()` — which resolves the account that activated an address from its oldest transaction, validating the candidate against the account's `create_time` so a later transfer is never mistaken for the activation. The guard tolerates a one-block (~3000 ms) skew because `create_time` trails the activating tx's confirmed `block_timestamp` by exactly one block even for a genuine activation (`ACTIVATION_CREATE_TIME_SKEW_MS`); a strict comparison would misreport every ordinary wallet as its own origin. Every method shares one rotating-key, 200ms-throttled request queue with live block sync.

A contract-created account is funded by a TVM-level transfer no top-level feed reports. Whenever the top-level path yields no edge — no transactions, a self-owned oldest transaction, or a candidate the `create_time` guard rejected — `getActivatingTransaction()` falls back to `resolveInternalActivator()`, which reads `/internal-transactions` and takes the oldest inbound, non-reverted, value-bearing transfer: same proximity test, `contractType: 'InternalTransaction'`, `txId` set to the parent transaction so explorer links resolve. Without it the climb walled off at every contract-created ancestor and reported a false origin. Null now means unresolvable from both feeds. Budget is two calls per hop, three on the fallback path. Selection logic is pinned by `__tests__/activating-transaction.test.ts`.

`BlockchainService.climbActivationAncestry()` (published on `IBlockchainService`) is the whole-ladder counterpart: it walks `getActivatingTransaction` from an address toward its origin — bounded by `MAX_ACTIVATION_ANCESTRY_DEPTH` (20), cycle-guarded — with an optional per-hop streaming callback and a shared edge cache so a batch of addresses fetches common tails once. The Address Origins tool and plugin discovery-provenance both consume it, so the bounded loop lives here once rather than being re-implemented per caller.

`climbActivationAncestrySteps()` is the same walk as an async generator — one provider lookup per `next()`, returning the finished `IActivationAncestry` when the climb stops. `climbActivationAncestry()` drains it, so there is still exactly one loop. It exists for callers climbing several addresses at once: the Address Origins stream drives one generator per wallet round-robin, so every ladder fills together instead of the last wallet waiting out the earlier ones. The shared `edgeCache` therefore holds the **in-flight promise** per child address, not the resolved edge — interleaved ladders converging on a common ancestor reach it before either lookup settles, and a resolved-value cache would let both fetch and duplicate every remaining call of the shared tail. A rejected lookup is evicted so it stays retryable.

Every ending is reported as `stopReason`: `'unresolved'`, `'depth-cap'`, `'cycle'`, or `'provider-error'`. **`'unresolved'` is not proof of a root** — a climb can only report that it ran out of resolvable activators, never that an account has none, and consumers must not word it as "origin reached". The legacy `originReached` / `truncated` booleans are derived from `stopReason` so existing consumers keep working.

A sibling transport, `TronScanClient`, lives in the [providers module](../providers/README.md) — a distinct provider with its own base URL, key, and rate budget, currently backing the local TRX price series. Reach for TronGrid for chain and account data; use TronScan only where no TronGrid path exists.

## Canonical documentation

- [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md) — block retrieval, enrichment pipeline, observer dispatch
- [plugins-blockchain-observers.md](../../../../docs/plugins/plugins-blockchain-observers.md) — building observers that react to transactions this module notifies
