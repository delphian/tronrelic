# Providers Module

Owns runtime configuration and HTTP clients for external data providers, kept out of env so an operator edits them live from the admin UI. First provider: **TronScan**, the TRX price source behind the local price-history series.

## Why It Is a Module

Provider credentials and transports are core, always-on infrastructure that core ingestion (price-history) depends on and the admin Providers tab edits. It is not runtime-toggleable and publishes shared singletons (the config store, the TronScan client), so it is a module, not a plugin. Storing the API key in the database — never env — is the whole point: it must be editable at runtime, survive restarts, and never appear in source.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `providers` |
| Module class | `src/backend/modules/providers/ProvidersModule.ts` |
| Admin page | `/system/system` → **Providers** tab (menu Submenu Pattern; the `system` namespace tabs are registered in bootstrap) |
| Mounted routes | `/api/admin/system/providers/*` (`createAdminRateLimiter` + `requireAdmin`) |
| Singletons | `ProviderConfigService` (DB-backed config + masking), `TronScanClient` (transport) |
| Owned storage | One KV blob per provider via `IDatabaseService.set` — key `provider:tronscan` |
| Scheduler jobs | none (consumed by price-history's jobs) |
| Bootstrap order | Inits **before** price-history, which reads the config service and client through the TronScan price provider |

## Source Map

| Path | Responsibility |
|------|----------------|
| `ProvidersModule.ts` | Lifecycle; wires the config/client singletons, mounts the admin router |
| `services/provider-config.service.ts` | `ProviderConfigService` — DB-backed read/write, secret masking (`****` + last 4), masked vs raw views |
| `clients/tron-scan.client.ts` | `TronScanClient` — `/api/trx/volume` transport + `testConnection()`; reads config per call |
| `api/providers.controller.ts` | Admin handlers; guards a re-echoed mask and the clear sentinel on save |
| `api/providers.routes.ts` | Router factory (guards applied at mount) |
| `database/index.ts` | KV key, config shapes (raw + masked), `CLEAR_SENTINEL`, defaults |

## REST Endpoints (`requireAdmin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/system/providers/tronscan` | Masked config (`apiKey` is `****abcd`, plus `apiKeyConfigured`) |
| PUT | `/api/admin/system/providers/tronscan` | Persist `apiKey?` / `baseUrl?` / `priceSource?` / `enabled?` |
| POST | `/api/admin/system/providers/tronscan/test` | Live connectivity/credential check — `{ result: { ok, message, latencyMs, … } }` |

The key is never returned in the clear. On save, a value beginning `****` (a re-echoed mask) is ignored, `__clear__` empties the key, and any other string sets it.

## TronScan Config

`provider:tronscan` → `{ apiKey?, baseUrl, priceSource, enabled }`. The key is optional — TronScan works keyless at lower rate limits. `priceSource` is `coinmarketcap | coingecko` (the sources `/api/trx/volume` reports from). `enabled: false` pauses TRX ingestion at the price provider. Defaults: `baseUrl: https://apilist.tronscanapi.com`, `priceSource: coinmarketcap`, `enabled: true`.

## Consuming the Client

The price-history `TronScanPriceHistoryProvider` calls `TronScanClient.getInstance().getTrxPriceVolume(startMs, endMs, source)` for TRX daily OHLC (`close` = the day's price) and resolves token assets to empty — TronScan has no per-token history. See the [Price History Module README](../price-history/README.md).

## Related

- [Price History Module README](../price-history/README.md) — the consumer; the TronScan provider and the two ingestion jobs it backs
- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` KV store the config persists to
- [Menu Module README](../menu/README.md) — the Submenu Pattern the `/system/system` tab row uses
