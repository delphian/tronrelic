# Providers Module

Owns runtime configuration and HTTP clients for external data providers, kept out of env so an operator edits them live from the admin UI. **TronScan** is live here — the TRX price source behind the local price-history series. **TronGrid** is staged with one exception: its connection settings and connectivity test exist but no runtime path reads them yet, while `fetchBlockReceipts` is read by block sync on every block.

## Why It Is a Module

Provider credentials and transports are core, always-on infrastructure that core ingestion (price-history) depends on and the system console's Configuration tab edits. It is not runtime-toggleable and publishes shared singletons (the config store, the provider clients), so it is a module, not a plugin. Storing the API key in the database — never env — is the whole point: it must be editable at runtime, survive restarts, and never appear in source.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `providers` |
| Module class | `src/backend/modules/providers/ProvidersModule.ts` |
| Admin page | `/system/system?tab=config` → **Configuration** tab (menu Submenu Pattern; the `system` namespace tabs are registered in bootstrap) |
| Mounted routes | `/api/admin/system/providers/*` (`createAdminRateLimiter` + `requireAdmin`) |
| Singletons | `ProviderConfigService` (DB-backed config + masking), `TronScanClient` (transport), `TronGridProviderClient` (staged; connectivity test only) |
| Owned storage | One KV blob per provider via `IDatabaseService.set` — keys `provider:tronscan`, `provider:trongrid` |
| Scheduler jobs | none (consumed by price-history's jobs) |
| Bootstrap order | Inits **before** price-history, which reads the config service and client through the TronScan price provider |

## Source Map

| Path | Responsibility |
|------|----------------|
| `ProvidersModule.ts` | Lifecycle; wires the config/client singletons, mounts the admin router |
| `services/provider-config.service.ts` | `ProviderConfigService` — DB-backed read/write, secret masking (`****` + last 4), masked vs raw views; `ProviderConfigValidationError` for operator-fixable rejections |
| `clients/tron-scan.client.ts` | `TronScanClient` — `/api/trx/volume` transport + `testConnection()`; reads config per call |
| `clients/tron-grid.client.ts` | `TronGridProviderClient` — staged transport; only `testConnection()` exists, probing every stored key |
| `api/providers.controller.ts` | Admin handlers; guards a re-echoed mask and the clear sentinel on save, bounds the TronGrid numerics |
| `api/providers.routes.ts` | Router factory (guards applied at mount) |
| `database/index.ts` | KV keys, config shapes (raw + masked), `CLEAR_SENTINEL`, `TRONGRID_LIMITS`, defaults |

## REST Endpoints (`requireAdmin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/system/providers/tronscan` | Masked config (`apiKey` is `****abcd`, plus `apiKeyConfigured`) |
| PUT | `/api/admin/system/providers/tronscan` | Persist `apiKey?` / `baseUrl?` / `priceSource?` / `enabled?` |
| POST | `/api/admin/system/providers/tronscan/test` | Live connectivity/credential check — `{ result: { ok, message, latencyMs, … } }` |
| GET | `/api/admin/system/providers/trongrid` | Masked config (`apiKeys` masked positionally, plus `apiKeyCount`) |
| PUT | `/api/admin/system/providers/trongrid` | Persist `enabled?` / `fetchBlockReceipts?` / `baseUrl?` / `requestThrottleMs?` / `maxQueueSize?` / `requestTimeoutMs?` — never keys |
| POST | `/api/admin/system/providers/trongrid/keys` | Append `{ apiKey }` to the rotation pool |
| DELETE | `/api/admin/system/providers/trongrid/keys/:index` | Remove the key at a rotation position |
| POST | `/api/admin/system/providers/trongrid/test` | Probe the stored config once per key, concurrently — `{ result: { ok, message, keyResults[] } }` |

No key is ever returned in the clear. TronScan: on save, a value beginning `****` (a re-echoed mask) is ignored, `__clear__` empties the key, and any other string sets it. TronGrid: keys are not writable through the config PUT at all — a form round-tripping a list of masked keys would overwrite real secrets the moment two keys shared their last four characters, so add and remove are separate operations keyed by position.

## TronScan Config

`provider:tronscan` → `{ apiKey?, baseUrl, priceSource, enabled }`. The key is optional — TronScan works keyless at lower rate limits. `priceSource` is `coinmarketcap | coingecko` (the sources `/api/trx/volume` reports from). `enabled: false` pauses TRX ingestion at the price provider. Defaults: `baseUrl: https://apilist.tronscanapi.com`, `priceSource: coinmarketcap`, `enabled: true`.

## TronGrid Config (connection settings staged; `fetchBlockReceipts` is live)

`provider:trongrid` → `{ enabled, fetchBlockReceipts, baseUrl, apiKeys[], requestThrottleMs, maxQueueSize, requestTimeoutMs }`.

### `fetchBlockReceipts` — the one live field

`BlockchainService.processBlock` reads this on every block through `ProviderConfigService.getInstance().getTronGridConfig()`. When it is on, sync adds one `getTransactionInfoByBlockNum` call — one for the whole block, whatever its transaction count — and joins the receipts back onto the block's transactions by `id`, which populates the per-transaction `energy`, `bandwidth`, and `internalTransactions` fields and therefore the `totalEnergyCost`, `totalEnergyUsed`, and `totalBandwidthUsed` block totals that sum them. With it off, sync passes `null` exactly as it always has and makes no extra call, which is why the default is `false`.

It is deliberately **independent of `enabled`**. That flag gates the unrelated switchover to a DB-backed client and is still read by nothing, so requiring it here would mean asking an operator to turn on a switch the same card documents as inert.

Because the switch can be toggled and nothing is backfilled, sync records the outcome per block: every block document, `block:new` payload, and `IBlockData` carries a `receiptsFetched` boolean, true only when every transaction in the block got a receipt. Consumers must check it before reading any receipt-derived figure, since a stored zero is otherwise indistinguishable from a measured one. See [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md#consumers-must-check-receiptsfetched).

Three things follow from where the read sits. It is per block and uncached, so a toggle takes effect on the next block rather than at the next restart — one KV read is negligible beside the TronGrid call the same block already makes. Resolution is lazy and swallows a failure as `false`, because `BlockchainService` is constructed during bootstrap before `ProvidersModule.init()` wires this singleton, and an unreachable config store must leave sync doing what it did before rather than stopping it. And nothing is backfilled: blocks indexed while the switch was off keep their zeros.

The value is coerced with `=== true` on read and the controller refuses a non-boolean body value rather than coercing it. Both guards exist because this is the only field here whose wrong value costs upstream requests, and a truthy string accepted behind a 200 would change a deployment's call rate with nothing in the form to show it.

That client reads `TRONGRID_API_KEY`, `TRONGRID_API_KEY_2`, `TRONGRID_API_KEY_3` from env and hardcodes `https://api.trongrid.io`, a 200 ms throttle, a 100-deep queue, and a 15 s timeout. This blob mirrors exactly those settings so the switchover is a change of source, not of contract; until it happens, editing those fields changes nothing at runtime.

The rest of the blob is still staged. TronGrid access — blockchain sync, chain parameters, USDT parameters, account history — reaches the network through `src/backend/modules/blockchain/tron-grid.client.ts`, which resolves its keys, host, and pacing from env and source regardless of what is stored here.

Defaults are deliberately *not* the running deployment: no env key is copied in, and `enabled` starts `false` so an untouched card cannot read as live. `MAX_TRONGRID_API_KEYS` caps the pool at 10 and `TRONGRID_LIMITS` bounds the three numeric fields (the controller rejects out-of-range values — and non-numeric ones such as `null` — rather than clamping them). `POST /trongrid/test` probes every stored key, concurrently and each capped at 15 s regardless of `requestTimeoutMs`, so a full pool against an unresponsive host still answers before the operator's browser gives up. A revoked key in a rotation pool answers nothing until it is the one selected, which is exactly the failure that must not survive to the cutover.

Both providers' `baseUrl` must be an absolute `http://` or `https://` URL; anything else is a 400. This is a security bound, not a typo guard — the stored host is where the client sends its keys, so an unvalidated string would make a config write an exfiltration path. Which host is deliberately unconstrained (a private full node is a supported target), leaving the admin gate on the route as the control over the destination.

## Consuming the Client

The price-history `TronScanPriceHistoryProvider` calls `TronScanClient.getInstance().getTrxPriceVolume(startMs, endMs, source)` for TRX daily OHLC (`close` = the day's price) and resolves token assets to empty — TronScan has no per-token history. See the [Price History Module README](../price-history/README.md).

## Related

- [Blockchain Module README](../blockchain/README.md) — home of the sibling `TronGridClient`; `TronScanClient` is the second external provider transport alongside it, and TronGrid (not TronScan) resolves chain and account data such as an address's activator
- [Price History Module README](../price-history/README.md) — the consumer; the TronScan provider and the two ingestion jobs it backs
- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` KV store the config persists to
- [Menu Module README](../menu/README.md) — the Submenu Pattern the `/system/system` tab row uses
