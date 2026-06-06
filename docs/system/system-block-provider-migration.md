# Block Provider Migration Design

Design for decoupling the blockchain sync pipeline from TronGrid behind a provider-neutral `IBlockProvider` abstraction: normalized chain types, a pinned observer contract for `rawValue`, and an incremental migration plan executable without breaking production.

**Status: proposed (June 2026).** Provider rate limits and pricing below are a June 2026 research snapshot — re-verify before procurement.

## Why This Matters

TronGrid is a single point of failure wired into core at ten call sites. Bootstrap refuses to start when TronGrid is unreachable, the sync pipeline types its internals against TronGrid wire structs, and TronGrid semantics leak to plugins through `ITransaction.rawValue` and hex memos. Failing over or switching providers today means a core rewrite under outage pressure. [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) already promises observers "never see raw TronGrid responses — that abstraction enables future provider changes"; this design closes the gaps that break that promise.

## Current Coupling (Audit)

| Surface | Location | Coupling |
|---|---|---|
| Sync fetch | `src/backend/modules/blockchain/blockchain.service.ts` | `tronClient = TronGridClient.getInstance()` — concrete singleton, never injected (database is injected via `setDependencies`; the provider is not) |
| Enrichment | `processBlock` / `buildTransactionRecord` in the same file | Typed against `TronGridBlock`/`TronGridTransaction`/`TronGridTransactionInfo`; walks `block_header.raw_data.*`, `raw_data.contract[0].parameter.value`, `raw_data.data`; µs/ms timestamp quirk normalized inline; hex→base58 via static `TronGridClient.toBase58Address` |
| Observer payload | `ITransaction` (`packages/types/src/transaction/`) | `rawValue` = raw `parameter.value` + `Permission_id`; `payload.memo` = raw hex of `raw_data.data` (JSDoc claims plain text); `info` typed `any`, receipt-shaped |
| Alerts | `src/backend/services/alert.service.ts` | Imports concrete `TronGridClient` + `TronGridEvent`; calls proprietary `/v1/transactions/{txId}/events`; imports its payload type from `blockchain.service.js` instead of `@/types` |
| Bootstrap fetchers | `modules/chain-parameters/chain-parameters-fetcher.ts`, `modules/usdt-parameters/usdt-parameters-fetcher.ts` | Hardcoded `https://api.trongrid.io/...` via raw axios — no throttle, no API keys; `initializeCoreServices` (`src/backend/index.ts`) awaits both and throws, **gating boot on TronGrid availability** |
| Monitoring | `modules/system/system-monitor.service.ts` | `getNowBlock()` for network height |
| Satellite services | `modules/analytics/calculator.service.ts`, `modules/energy/energy.service.ts`, `modules/tools/` (approval, timestamp), `modules/identity/IdentityModule.ts` | Concrete client via constructor defaults or inline `getInstance()` |
| Plugin context | `loaders/plugins.ts` → `IPluginContext.tronGrid` | Concrete client typed as `ITronGridService` — a provider-named interface whose `createTronWeb` returns `any` |

Behavioral facts that constrain the migration: the only plugin reading `rawValue` is `trp-delegation-pools` (`Permission_id`); `trp-memo-tracker` depends on hex-memo semantics; no plugin reads `info` (it is always `null` in the sync path — see the energy-cost limitation in [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md)); `ret[].contractRet` is fetched but never read, so failed transactions are persisted and counted as successful — a quirk to preserve, not silently fix; the client's `getTransactionInfo` has zero production callers. `blockchain.service.ts` and `tron-grid.client.ts` have **no tests**, and the blockchain directory is not an `IModule` (no module class, no README; `index.ts` carries the migration `@todo`).

## Provider Landscape (June 2026 Snapshot)

Cost baseline: sync at ~5 req/s ≈ 13.1M requests/month.

| Provider | Native `/wallet/*` (our 9) | `/walletsolidity` | `/v1` indexer | Auth | Cost @ 13M req/mo | Verdict |
|---|---|---|---|---|---|---|
| TronGrid (today) | 9/9 verbatim | yes | **yes — only provider** | `TRON-PRO-API-KEY` header | free (3-key rotation) | incumbent |
| Chainstack | 9/9 verbatim, documented | yes (42 methods) | no | key-in-path | $49 flat (Growth: 1 RU/req, 250 RPS, 99.99% SLA) | **best hosted failover** |
| ZAN | 6/9 documented; `getenergyprices` + delegation-v2 undocumented (probe) | not documented | no | key-in-path | ~$26 (derived) | secondary, needs probe |
| QuickNode | 9/9 (+gRPC) | yes | no | key-in-path | $249 (flat 30 credits/call) | solid, pricier |
| GetBlock | 9/9 (docs prose unreliable; wire verbatim) | yes | no | token-in-path | $399 (~20 CU/call) | viable fallback |
| Ankr | gaps: `getenergyprices`, delegation-v2, likely `getaccountresource` | yes | no | token-in-path | ~$262 PAYG | avoid |
| TronScan | 0/9 — proprietary indexer, **no embedded txs in blocks**, ~19 blocks (~57s) behind head, `start+limit ≤ 10000` | n/a | no txid-events lookup | `TRON-PRO-API-KEY` | 100k req/day cap | unusable for sync; enrichment only |
| TronStack | **defunct** — parked domain, no API | — | — | — | — | drop from candidate set |
| Tatum | no (own `/v3/tron/*` envelope) | — | **TRC20 history w/ fingerprint paging** | `x-api-key` header | niche | endpoint-11 companion only |
| Self-hosted java-tron | 9/9 native + `getblockbylimitnext` (≤100 blocks/call) | yes (port 8091) | no — event-plugin or log parsing | none | ~$150–400/mo bare-metal + ops | end-state option; lite node (~3% of ~3 TB) suffices for tip-following but breaks historical lookups |

Five facts shape the design:

1. **`/wallet/*` bodies are byte-identical** across TronGrid, Chainstack, ZAN, QuickNode, GetBlock, and a raw node — all proxy java-tron, none wrap envelopes, all honor `visible`. The "TronGrid shapes" in the codebase are chain-canonical java-tron shapes wearing a vendor name; parsing is already portable, only the client plumbing is not.
2. **The two `/v1` endpoints are TronGrid-proprietary** (`/v1/transactions/{txId}/events`, `/v1/accounts/{addr}/transactions/trc20`). No RPC host replicates them. They must be a separate optional capability, not part of `IBlockProvider`. AlertService's events use is replaceable today by `gettransactioninfobyid` log parsing at identical call cost.
3. **Auth and rate models diverge structurally**: header vs key-in-path; QPS vs credits/s vs flat RU. Throttle policy and key handling must be per-provider config, not the module-global 200 ms constant.
4. **No provider offers TRON push/streaming** — polling stays the design; `IBlockProvider` needs no subscription surface.
5. **Capability gaps are per-endpoint, not per-provider** (Ankr's missing resource reads, ZAN's undocumented passthrough) — the abstraction needs a capability map verified by a fail-fast startup probe.

## Target Architecture

Split the four concerns currently fused in `TronGridClient`:

- **`IBlockProvider`** — the sync feed: chain head + block-with-transactions (+ optional ≤100-block range fetch and per-tx execution lookup).
- **`ITronQueryProvider`** — current-state node reads (account, resources, delegation, energy prices, constant-contract) used by the satellite services and bootstrap fetchers.
- **`ITronIndexProvider`** — `/v1`-class indexer reads (events-by-txid, TRC20 history), optional, satisfiable by TronGrid, Tatum, receipt-log parsing, or a future self-index.
- **`src/backend/lib/tron-address.ts`** — pure base58check/hex codecs and memo decode, extracted from `TronGridClient` statics (conversion needs no provider).

Types live in `packages/types/src/chain/` — additive, so plugins compile unchanged against the local alias.

```typescript
export interface IChainContractCall {
    type: string;                              // 'TransferContract', 'DelegateResourceContract', …
    /** Canonical TRON contract parameter value — java-tron protobuf-JSON form:
     *  snake_case keys, 41-prefixed hex addresses (visible=false), SUN amounts.
     *  Chain-defined, not provider-defined; adapters MUST normalize into it. */
    parameterValue: Record<string, unknown>;
    permissionId?: number;                     // Permission_id; >=3 ⇒ custom (pool) permission
}

export interface IChainTransaction {
    txId: string;
    contracts: IChainContractCall[];           // [0] is the primary contract
    memoHex: string | null;                    // raw_data.data verbatim (hex of UTF-8 bytes)
    result?: string;                           // ret[0].contractRet — carried, never filtered on
}

export interface IChainBlock {
    blockNumber: number; blockId: string; parentHash: string;
    witnessAddress: string;                    // base58 (matches IBlockData contract)
    timestamp: Date;                           // adapter owns the µs/ms normalization quirk
    sizeBytes?: number;
    transactions: IChainTransaction[];
}

export interface IBlockProvider {
    readonly id: string;                       // 'trongrid' | 'chainstack' | 'java-tron' | …
    /** Declared history depth: 'full' (archive), 'lite' (state + ~65k recent blocks), 'unknown' (hosted, unverified). */
    readonly historyDepth: 'full' | 'lite' | 'unknown';
    getChainHead(): Promise<IChainHead>;
    getBlockByNumber(num: number): Promise<IChainBlock | null>;
    getBlockRange?(startNum: number, endNumExclusive: number): Promise<IChainBlock[]>;
    getTransactionExecution?(txId: string): Promise<IChainTransactionExecution | null>;
    capabilities(): Readonly<Record<string, boolean>>;
}
```

### The rawValue Contract

When the upstream is not TronGrid, `rawValue` means **the contract parameter value in TRON's canonical protobuf-JSON form, plus `Permission_id`** — exactly what java-tron emits from `getblockbynum` with `visible=false`. The pin is chain-defined (the protobuf JSON mapping), not vendor-defined: java-tron-proxy adapters pass it through untouched, so `trp-delegation-pools` keeps working unmodified; exotic adapters (indexer-class, gRPC) must reconstruct that form or be excluded from the sync role by their capability map. The `ITransaction.rawValue` JSDoc changes from "Original contract parameter values from TronGrid API" to "Canonical TRON contract parameter value (java-tron protobuf-JSON form) plus `Permission_id`".

Alongside the pin, `payload.permissionId?: number` becomes a typed field so the one known `rawValue` consumer can migrate off it; `rawValue` stays populated indefinitely as the compatibility surface for private plugins. The same pinning applies to **memo** — `payload.memo` is the hex encoding of the on-chain bytes (the JSDoc is corrected; `trp-memo-tracker` already decodes client-side) — and to **`info`**, which retypes from `any` to `IChainTransactionExecution | null` (verified zero consumers; remains `null` in the sync path).

Two deliberate constraints: adapters must **not** filter failed transactions (today `contractRet` is ignored; changing that is a separate proposal, not something to smuggle into a zero-change migration), and the design assumes **polling** — no streaming abstraction.

### Forward Compatibility: Historic Reads

The interface is height-addressed — `getBlockByNumber(n)` and `getBlockRange(a, b)` serve historic blocks wherever the upstream retains them — so a later full-history java-tron node or deep-backfill feature requires no interface change. Two declarations keep that path explicit instead of discovered at runtime. First, every adapter states its `historyDepth`: `'full'` (archive), `'lite'` (java-tron lite nodes prune beyond ~65,536 blocks, breaking old `getblockbynum`/`gettransactioninfobyid`), or `'unknown'` (hosted providers with unverified archive depth, e.g. Chainstack) — future historic features route or refuse on this declaration. Second, the `wallet` vs `walletsolidity` namespace is per-provider config: head reads today, but the confirmed-read axis stays open (deep history is solidified by definition, so historic reads are unaffected either way).

The remaining tip bias lives in the **pipeline**, not the abstraction: fresh-install cursor at network height, the 240-block backfill ceiling, 7-day transaction pruning, current-price USD enrichment (wrong for old blocks), and live observer dispatch (replaying history through observers would emit bogus real-time events). Historic ingestion is therefore a pipeline feature — separate ingest job, backfill-aware dispatch, historical price source, its own retention story (ClickHouse is the natural store) — built on the same `IBlockProvider`, not a provider change.

## Migration Plan

Each step is a separate PR, independently shippable. TronGrid remains the hard default until Step 8 makes selection explicit. Observer payloads are byte-identical through Step 5, proven by golden tests.

**Step 1 — Golden fixtures + characterization tests.** Capture 4–6 real `getblockbynum` responses (transfer-heavy, delegation with `Permission_id ≥ 3`, memo, SunPump-style `TriggerSmartContract`, `AssetIssueContract`, string-amount edge case) into `modules/blockchain/__tests__/fixtures/`; snapshot full `ProcessedTransaction` output per fixture. Requires the minimal seam of marking `buildTransactionRecord` `/** @internal */` public. *Blast radius: none. Rollback: revert.*

**Step 2 — Types package.** Add `packages/types/src/chain/` (types above plus `ITronQueryProvider`/`ITronIndexProvider`), re-export, and update `ITransaction`/`ITransactionPersistencePayload` JSDoc to the pinned contracts with `permissionId?`. Purely additive. *Blast radius: none. Rollback: revert.*

**Step 3 — `TronGridBlockProvider`, shipped dark.** `modules/blockchain/providers/tron-grid.provider.ts` wraps the untouched `TronGridClient`, owning wire→`IChainBlock` mapping: the µs/ms timestamp quirk moves here; witness conversion uses the new `lib/tron-address.ts` (client statics become thin delegates). Fixture-driven mapping tests become the shared `describeBlockProviderContract()` suite every adapter must pass. Nothing consumes it yet. *Blast radius: none. Rollback: revert.*

**Step 4 — Migrate enrichment internals to normalized types.** Extract `buildTransactionRecord` and helpers (`resolveRecipient`, `resolveAmounts`, `describeContract`, `normalizeContractType`, `buildEnergyMetrics`/`buildBandwidthMetrics`) into a pure `transaction-enricher.ts` typed against `IChainBlock`/`IChainTransaction`; `processBlock` maps the fetched wire block through the adapter's mapper and works on `IChainBlock` throughout (including `emitSocketEvents` and `IBlockData` assembly). `rawValue` assembles as `{...parameterValue, Permission_id: permissionId}` — byte-identical, proven by the Step 1 golden suite. *Blast radius: the per-block pipeline — the riskiest step, contained in one file plus one pure module. Rollback: revert; no schema, config, or contract movement.*

**Step 5 — Inject `IBlockProvider` via DI.** `BlockchainService.setDependencies(database, deps?: { blockProvider?: IBlockProvider })` per the singleton convention; both call sites (`modules/scheduler/jobs/core-jobs.ts`, `loaders/plugins.ts`) pass the TronGrid adapter explicitly. `syncLatestBlocks` uses `getChainHead()`; `processBlock` uses `getBlockByNumber()`; `system-monitor.service.ts` drops its client import for a provider-backed `BlockchainService.getNetworkBlockHeight()`. Canary on the ephemeral dev droplet, watch `/system` sync metrics, then prod. Service tests now inject a fake provider serving fixtures — the first real `BlockchainService` tests. *Blast radius: sync fetch path + monitor. Rollback: revert; the cursor only advances on success and the 240-block backfill window (~12 min of chain) covers redeploy gaps.*

**Step 6 — Observer contract formalization.** Document the pinned contracts in [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) and types JSDoc; populate `payload.permissionId`; separate PR in `trp-delegation-pools` switching `rawValue.Permission_id` → `payload.permissionId` (core deploys first). `rawValue` keeps flowing — this removes the last known consumer without breaking unknown ones. *Blast radius: docs + one additive field + one plugin. Rollback: plugin reverts independently.*

**Step 7 — Untangle `alert.service.ts`.** Import `ITransactionPersistencePayload` from `@/types`; use `lib/tron-address.ts`; replace the concrete client with an injected `ITronIndexProvider` exposing `getTransactionEvents(txId)`. Ship two implementations: `TronGridV1EventSource` (current behavior, default) and `TransactionInfoLogEventSource` (derives `OwnershipTransferred` from receipt logs — same call count, node-portable). *Blast radius: memo + SunPump alert flows; upsert-idempotent on `txId`. Rollback: revert.*

**Step 8 — Provider selection via config.** Zod additions to `src/backend/config/env.ts`: `BLOCK_PROVIDER` (enum, default `trongrid`), `TRON_FULLNODE_HTTP_URL`, `TRON_FULLNODE_API_KEYS` (CSV), `TRON_PROVIDER_AUTH_MODE` (`header|path`), `TRON_PROVIDER_RPS`, `TRON_PROVIDER_NAMESPACE` (`wallet|walletsolidity`, default `wallet`). A generic `JavaTronHttpProvider` — base-URL template, header-or-path key injection, configurable key pool and throttle — of which TronGrid becomes a preset (zero change for the default). A startup capability probe fails fast if the selected provider misses required endpoints, and spot-checks a deep historical block when `historyDepth` is declared `'full'`. Soak on dev against a Chainstack key before offering in prod. **Ops caveat: new prod env vars must be wired in compose passthrough, smoke test, preflight, and `.env` (see tronrelic-ops deployment docs) or prod crash-loops.** *Blast radius: client construction; default path identical. Rollback: `BLOCK_PROVIDER=trongrid` env flip — no code revert.*

**Step 9 — Decouple the bootstrap fetchers.** `ChainParametersFetcher`/`UsdtParametersFetcher` swap hardcoded URLs + raw axios for an injected `ITronQueryProvider`, gaining throttle, key rotation, and failover. Decision point: keep boot fail-fast, or degrade to last-stored Mongo parameters with a warning (recommended — both services already read from Mongo and refresh every 10 minutes; requires explicit approval as a behavior change). *Blast radius: bootstrap + two 10-minute cron jobs. Rollback: revert.*

**Optional follow-ons (separate proposals):** consolidate satellite services and `IPluginContext.tronGrid` onto `ITronQueryProvider` (keep `context.tronGrid` as a deprecated alias with unchanged `getAccount` signature); formalize a real `BlockchainModule` (`IModule` init/run + README, retiring the bootstrap `@todo`); self-hosted lite java-tron behind `JavaTronHttpProvider`; `getBlockRange` batch fetch for catch-up; TRC20-history replacement (Tatum or self-built receipt-log index) to retire the last `/v1` dependency.

## Risks and Open Verification Items

Risk concentrates in Step 4 and is mitigated by the Step 1 golden suite — without fixtures, no refactor here is provably safe, which is why they come first. Verify before relying on: ZAN's undocumented endpoint passthrough (Step 8's probe operationalizes this); Chainstack archive depth (irrelevant for tip-following, relevant for deep backfill); whether TronGrid silently flips any `visible` default versus a raw node (run the Step 8 parity test); Ankr's `getaccountresource` absence (keep Ankr out of rotation). Drop TronStack from any provider list — the domain is parked and no API exists.

## Further Reading

- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — the pipeline this design refactors: stages, throttle, backfill, energy-cost limitation
- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — the observer payload contract this design pins and preserves
- [modules-architecture.md](./modules/modules-architecture.md) — singleton `setDependencies`/`getInstance` and DI conventions the steps follow
- [system-testing.md](./system-testing.md) — Vitest mock infrastructure used by the fixture and adapter contract suites
- [environment.md](../environment.md) — env var behaviors; Step 8 adds the `BLOCK_PROVIDER` family
