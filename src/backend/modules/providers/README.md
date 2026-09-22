# Providers Module

Owns the vendor registry, runtime configuration, and HTTP clients for external data vendors, kept out of env so an operator edits them live from the admin UI. A **vendor** is one external service (TronScan, TronGrid, CoinGecko, GeckoTerminal). A **capability** is one thing a vendor can do for the platform (`price-history`, and `blocks` once the `IBlockProvider` migration lands). A vendor is declared once here with its descriptor, defaults, connectivity test, and enabled check; the module that owns a capability attaches its per-vendor implementation to the registry, and consumers ask the registry for vendors by capability rather than by name.

**TronScan**, **CoinGecko**, and **GeckoTerminal** are live price vendors. **TronGrid** is staged with one exception: its connection settings and connectivity test exist but no runtime path reads them yet, while `fetchBlockReceipts` is read by block sync on every block.

## Why It Is a Module

Vendor credentials, the registry, and the transports are core, always-on infrastructure that core ingestion (price-history) depends on and the system console's Configuration tab edits. It is not runtime-toggleable and publishes shared singletons, so it is a module, not a plugin. Storing an API key in the database — never env — is the whole point: it must be editable at runtime, survive restarts, and never appear in source.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `providers` |
| Module class | `src/backend/modules/providers/ProvidersModule.ts` |
| Admin page | `/system/system?tab=config` → **Configuration** tab (menu Submenu Pattern; the `system` namespace tabs are registered in bootstrap). One generic card per vendor, rendered from its descriptor; TronGrid has a bespoke card |
| Mounted routes | `/api/admin/system/providers/*` (`createAdminRateLimiter` + `requireAdmin`) |
| Singletons | `ProviderRegistry` (vendors + attached capabilities), `ProviderConfigService` (DB-backed config + masking), `TronScanClient`, `CoinGeckoClient`, `GeckoTerminalClient`, `TronGridProviderClient` (staged; connectivity test only) |
| Owned storage | One KV blob per vendor via `IDatabaseService.set` — key `provider:<vendorId>` (`providerConfigKey()`) |
| Capability seams | `capabilities/IPriceHistoryProvider.ts` (`IPriceHistoryProvider`, `ISourcedPricePoint`), `capabilities/ProviderDisabledError.ts` |
| Scheduler jobs | none (consumed by price-history's jobs) |
| Bootstrap order | Inits **before** price-history, which receives `getRegistry()` through its dependencies and attaches its price adapters |

## Source Map

| Path | Responsibility |
|------|----------------|
| `ProvidersModule.ts` | Lifecycle; wires the singletons, declares the four vendors in the registry, mounts the admin router, exposes `getRegistry()` |
| `services/provider-registry.service.ts` | `ProviderRegistry` / `IProviderRegistry` — `registerVendor`, `attachPriceHistoryProvider`, `getVendor`, `listVendors`, `listVendorsWithCapability`, `getPriceHistoryProvider`; `IProviderTestResult` |
| `services/provider-config.service.ts` | `ProviderConfigService` — generic `getConfig` / `getMaskedConfig` / `saveConfig` driven by a descriptor, typed readers per vendor, the TronGrid key-pool writes, secret masking (`****` + last 4); `ProviderConfigValidationError` |
| `capabilities/IPriceHistoryProvider.ts` | The `price-history` capability contract: `supportsAsset`, `fetchRange` returning `ISourcedPricePoint[]`, optional `forgetAsset` |
| `capabilities/ProviderDisabledError.ts` | Thrown by an implementation whose vendor is switched off; routing code skips the vendor on it |
| `clients/tron-scan.client.ts` | `TronScanClient` — `/api/trx/volume` transport + `testConnection()` |
| `clients/coin-gecko.client.ts` | `CoinGeckoClient` — `market_chart/range` by coin id or contract, tier-aware key header, 404 and history-wall handling, `getSpotTrxPriceUsd()` (one attempt, 5 s timeout) for block sync's `PriceService`, `testConnection()` |
| `clients/gecko-terminal.client.ts` | `GeckoTerminalClient` — pool selection by reserve and preferred quote, daily OHLCV with history-wall handling, `testConnection()` |
| `clients/tron-grid.client.ts` | `TronGridProviderClient` — staged transport; only `testConnection()` exists, probing every stored key |
| `api/providers.controller.ts` | Generic list/read/save/test by vendor id, validated field-by-field from the descriptor; bespoke TronGrid handlers |
| `api/providers.routes.ts` | Router factory (guards applied at mount); TronGrid routes declared before `/:id` |
| `database/index.ts` | `ProviderCapability`, `IProviderFieldDescriptor`, `IProviderDescriptor`, the four descriptors, config shapes (raw + masked), defaults, `CLEAR_SENTINEL`, limits |

## Vendor Descriptor

A descriptor is what the admin surface knows about a vendor without knowing the vendor: `id`, `label`, `description`, `docsUrl`, `capabilities`, `fields`, and `custom`. Each field has a `kind` — `secret`, `text`, `url`, `boolean`, `select`, `integer` — and the kind carries both the control the card renders and the validation rule the save handler applies, so the two cannot disagree. A `secret` is masked on read and paired with a `<key>Configured` boolean; a `url` must be an absolute `http(s)://` URL; an `integer` is bounded by `min`/`max`; a `select` must be one of its `options`; a `boolean` must be a real boolean.

To add a vendor: declare its config shape, defaults, and descriptor in `database/index.ts`; write a client under `clients/` that reads its config from `ProviderConfigService` per call and offers `testConnection()`; register it in `ProvidersModule.init()`. The list endpoint, the generic routes, and the Configuration tab card follow with no further change. If the vendor implements a capability, the module that owns that capability attaches the implementation.

## REST Endpoints (`requireAdmin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/system/providers` | Every vendor: `{ ...descriptor, config }` with secrets masked, in registration order |
| GET | `/api/admin/system/providers/:id` | One vendor's masked config; 404 for an unknown id |
| PUT | `/api/admin/system/providers/:id` | Persist descriptor fields. Any refused field fails the save with 400 listing every reason. Refused with 400 for a `custom` vendor |
| POST | `/api/admin/system/providers/:id/test` | The vendor's live connectivity/credential check — `{ result: { ok, message, latencyMs?, usingKey? } }` |
| GET | `/api/admin/system/providers/trongrid` | Masked config (`apiKeys` masked positionally, plus `apiKeyCount`) |
| PUT | `/api/admin/system/providers/trongrid` | Persist `enabled?` / `fetchBlockReceipts?` / `baseUrl?` / `requestThrottleMs?` / `maxQueueSize?` / `requestTimeoutMs?` — never keys |
| POST | `/api/admin/system/providers/trongrid/keys` | Append `{ apiKey }` to the rotation pool |
| DELETE | `/api/admin/system/providers/trongrid/keys/:index` | Remove the key at a rotation position |
| POST | `/api/admin/system/providers/trongrid/test` | Probe the stored config once per key, concurrently — `{ result: { ok, message, keyResults[] } }` |

No key is ever returned in the clear. On a generic save, a secret beginning `****` (a re-echoed mask) is ignored, `__clear__` empties it, and any other string sets it. TronGrid keys are not writable through its config PUT at all — a form round-tripping a list of masked keys would overwrite real secrets the moment two keys shared their last four characters, so add and remove are separate operations keyed by position.

## Vendor Configs

| Vendor | KV key | Shape | Defaults |
|--------|--------|-------|----------|
| TronScan | `provider:tronscan` | `{ enabled, apiKey?, priceSource, baseUrl }`; `priceSource` is `coinmarketcap \| coingecko` | enabled, keyless, `coinmarketcap`, `https://apilist.tronscanapi.com` |
| CoinGecko | `provider:coingecko` | `{ enabled, apiKey?, keyTier, baseUrl }`; `keyTier` is `demo \| pro` and picks the key header (`x-cg-demo-api-key` / `x-cg-pro-api-key`). A Pro key must use `https://pro-api.coingecko.com/api/v3` | enabled, keyless, `demo`, `https://api.coingecko.com/api/v3` |
| GeckoTerminal | `provider:geckoterminal` | `{ enabled, baseUrl, minPoolReserveUsd }` — a token whose deepest pool holds less than the floor is left unpriced | enabled, `https://api.geckoterminal.com/api/v2`, 10,000 |
| TronGrid | `provider:trongrid` | `{ enabled, fetchBlockReceipts, baseUrl, apiKeys[], requestThrottleMs, maxQueueSize, requestTimeoutMs }` | see below |

Keyless CoinGecko reaches back 365 days. The client recognises the wall (HTTP 401, body code 10012) and answers empty so the router falls through to the next vendor. CoinGecko nests that code as `error.status.error_code`, and other refusals put it at `status.error_code`, so the client reads both. A 401 without the code is a rejected key and is thrown. GeckoTerminal's public API reaches back 180 days and refuses older candles with HTTP 401, with a body that states the limit. That body carries no numeric code, so the client checks the message before answering empty. A 401 without it is an authorization failure from whatever the configured base URL points at, and is thrown. GeckoTerminal picks the deepest pool quoted in USDT, USDC, USDD, or wrapped TRX, falling back to the deepest pool of any kind, and remembers the choice per process.

Every client retries through `src/backend/lib/retry.ts`, which retries only network failures, 408, 425, 429, and 5xx responses, randomizes each backoff wait, and honours `Retry-After`. A 404 or a history-wall 401 is therefore answered after one request.

## TronGrid Config (connection settings staged; `fetchBlockReceipts` is live)

### `fetchBlockReceipts` — the one live field

`BlockchainService.processBlock` reads this on every block through `ProviderConfigService.getInstance().getTronGridConfig()`. When it is on, sync adds one `getTransactionInfoByBlockNum` call — one for the whole block, whatever its transaction count — and joins the receipts back onto the block's transactions by `id`, which populates the per-transaction `energy`, `bandwidth`, and `internalTransactions` fields and therefore the `totalEnergyCost`, `totalEnergyUsed`, and `totalBandwidthUsed` block totals that sum them. With it off, sync passes `null` exactly as it always has and makes no extra call, which is why the default is `false`.

It is deliberately **independent of `enabled`**. That flag gates the unrelated switchover to a DB-backed client and is still read by nothing, so requiring it here would mean asking an operator to turn on a switch the same card documents as inert.

Because the switch can be toggled and nothing is backfilled, sync records the outcome per block: every block document, `block:new` payload, and `IBlockData` carries a `receiptsFetched` boolean, true only when every transaction in the block got a receipt. Consumers must check it before reading any receipt-derived figure, since a stored zero is otherwise indistinguishable from a measured one. See [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md#consumers-must-check-receiptsfetched).

Three things follow from where the read sits. It is per block and uncached, so a toggle takes effect on the next block rather than at the next restart — one KV read is negligible beside the TronGrid call the same block already makes. Resolution is lazy and swallows a failure as `false`, because `BlockchainService` is constructed during bootstrap before `ProvidersModule.init()` wires this singleton, and an unreachable config store must leave sync doing what it did before rather than stopping it. And nothing is backfilled: blocks indexed while the switch was off keep their zeros.

The value is coerced with `=== true` on read and the controller refuses a non-boolean body value rather than coercing it. Both guards exist because this is the only field here whose wrong value costs upstream requests, and a truthy string accepted behind a 200 would change a deployment's call rate with nothing in the form to show it.

### The staged fields

The live TronGrid client reads `TRONGRID_API_KEY`, `TRONGRID_API_KEY_2`, `TRONGRID_API_KEY_3` from env and hardcodes `https://api.trongrid.io`, a 200 ms throttle, a 100-deep queue, and a 15 s timeout. This blob mirrors exactly those settings so the switchover is a change of source, not of contract; until it happens, editing those fields changes nothing at runtime. TronGrid access — blockchain sync, chain parameters, USDT parameters, account history — reaches the network through `src/backend/modules/blockchain/tron-grid.client.ts`, which resolves its keys, host, and pacing from env and source regardless of what is stored here.

Defaults are deliberately *not* the running deployment: no env key is copied in, and `enabled` starts `false` so an untouched card cannot read as live. `MAX_TRONGRID_API_KEYS` caps the pool at 10 and `TRONGRID_LIMITS` bounds the three numeric fields (the controller rejects out-of-range values — and non-numeric ones such as `null` — rather than clamping them). `POST /trongrid/test` probes every stored key, concurrently and each capped at 15 s regardless of `requestTimeoutMs`, so a full pool against an unresponsive host still answers before the operator's browser gives up.

Every vendor's `baseUrl` must be an absolute `http://` or `https://` URL; anything else is a 400. This is a security bound, not a typo guard — the stored host is where the client sends its keys, so an unvalidated string would make a config write an exfiltration path. Which host is deliberately unconstrained (a private full node is a supported target), leaving the admin gate on the route as the control over the destination.

## Consuming a Capability

A consumer module receives `IProviderRegistry` through its `init(deps)` and never names a vendor. The price-history module attaches one `IPriceHistoryProvider` per price vendor during its own `init()` and hands its service a routing provider that reads `listVendorsWithCapability('price-history')` and the operator's ordered source lists. An implementation returns `[]` when its vendor has nothing for the asset or range, throws `ProviderDisabledError` when the vendor is switched off, and throws anything else on a transport failure. The router falls through on the first two, fails the tick on the third, and reports to its consumer which of the two it saw: an empty answer after a skipped vendor is inconclusive, and the price-history service backs off and asks again rather than recording it. See the [Price History Module README](../price-history/README.md).

## Related

- [Price History Module README](../price-history/README.md) — the consumer; the per-vendor adapters, the routing provider, and the two ingestion jobs
- [Blockchain Module README](../blockchain/README.md) — home of the live `TronGridClient`; TronGrid (not TronScan) resolves chain and account data such as an address's activator
- [system-block-provider-migration.md](../../../../docs/system/system-block-provider-migration.md) — the `IBlockProvider` design the `blocks` capability is reserved for
- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` KV store the config persists to
- [Menu Module README](../menu/README.md) — the Submenu Pattern the `/system/system` tab row uses
