# Plugin Catalog

Index of every plugin shipped under `src/plugins/` plus the per-market integrations bundled inside `trp-resource-markets`.

## Why This Matters

Agents and operators routinely waste effort building features the platform already ships. Before scoping a new plugin, scan this catalog: a similar observer, admin surface, or service registry provider may already exist. The market sub-table covers the dominant integration surface — `trp-resource-markets` aggregates 18 separate marketplaces and is the most common place new TRON pricing sources land.

## Plugins

| Plugin | Purpose | README |
|--------|---------|--------|
| trp-ai-assistant | Admin-only Claude API console; streams answers and runs Batch jobs at 50% cost; other plugins register template variables and tools through the service registry. | [README](../../src/plugins/trp-ai-assistant/README.md) |
| trp-bazi-fortune | 八字命理 Four Pillars readings keyed off each wallet's on-chain `create_time`; daily Wu Xing fortune via Beijing-time pillars. | [README](../../src/plugins/trp-bazi-fortune/README.md) |
| trp-delegation-pools | Detects distributed energy pools by flagging delegations signed with permission ID ≥ 3; ranks operators by delegation volume. | [README](../../src/plugins/trp-delegation-pools/README.md) |
| trp-dust-tracker | Detects address-poisoning attacks; scores incoming dust against a 48h counterparty cache; rolls up to minute/hour/day/month. | [README](../../src/plugins/trp-dust-tracker/README.md) |
| trp-forum | Wallet-signed posts (TronLink `signMessageV2`); shrinking randomly-positioned canvas, 7-day expiry, emoji reactions. | [README](../../src/plugins/trp-forum/README.md) |
| trp-image-gen | Admin-only image generation; pluggable provider backends (`NanoBananaProvider` first); publishes `IImageGenerationService` and registers per-provider AI tools with `ai-assistant`. | [README](../../src/plugins/trp-image-gen/README.md) |
| trp-memo-tracker | Indexes UTF-8 memos across six contract types; live feed for everyone, search and history gated on verified wallet. | [README](../../src/plugins/trp-memo-tracker/README.md) |
| trp-resource-markets | Aggregates 18 TRON energy markets into one normalized `MarketSnapshot`; SUN-per-energy comparisons across hour/day/week rentals. | [docs/markets.md](../../src/plugins/trp-resource-markets/docs/markets.md) |
| trp-resource-tracker | Observes `DelegateResourceContract` / `UnDelegateResourceContract`; raw retention 2d, summations 6mo, optional whale-delegation flagging. | [README](../../src/plugins/trp-resource-tracker/README.md) |
| trp-telegram-bot | Telegram webhook bot serving `/price` market lookups; IP allowlist, secret token, per-user rate limit. | [README](../../src/plugins/trp-telegram-bot/README.md) |
| trp-whale-alerts | Real-time whale transaction detection and alert dispatch for the TRON network. | [package.json](../../src/plugins/trp-whale-alerts/package.json) |
| trp-x-poster | Service-registry `x-poster` provider; `postTweet` (immediate or scheduled), `readTimelines`, image upload via X v1.1 media. | [README](../../src/plugins/trp-x-poster/README.md) |

## Markets (under trp-resource-markets)

Each market lives at `src/plugins/trp-resource-markets/src/markets/<name>/` with a fetcher and a README. Several READMEs are stub templates ("Market Type: Unknown") — those entries reflect what the README itself says.

| Market | Purpose | README |
|--------|---------|--------|
| api-trx | apitrx.com — API-first platform; HTML pricing table scraped from `/en/pages/price.html`, no auth. | [README](../../src/plugins/trp-resource-markets/src/markets/api-trx/README.md) |
| arc-vaults | arcvaults.com — flash energy SPA scraped via headless Playwright; recent purchases via `/api/recent-energy-purchases`. | [README](../../src/plugins/trp-resource-markets/src/markets/arc-vaults/README.md) |
| brutus-finance | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/brutus-finance/README.md) |
| catfee | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/catfee/README.md) |
| ergon | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/ergon/README.md) |
| feee-io | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/feee-io/README.md) |
| mefree-net | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/mefree-net/README.md) |
| rent-tron | renttron.com — single flat 1-hour rate; OpenAPI-documented `GET /api/prices`, no auth. | [README](../../src/plugins/trp-resource-markets/src/markets/rent-tron/README.md) |
| tron-energize | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/tron-energize/README.md) |
| tron-energy-market | P2P marketplace only — endpoint not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/tron-energy-market/README.md) |
| tron-energy | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/tron-energy/README.md) |
| tron-fee-energy-rental | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/tron-fee-energy-rental/README.md) |
| tron-lending | tronlending.xyz — 8×6 pricing matrix (1–30d × 1M–100M energy) via Playwright; REST endpoints supply pool balances. | [README](../../src/plugins/trp-resource-markets/src/markets/tron-lending/README.md) |
| tron-pulse | P2P marketplace only — endpoint not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/tron-pulse/README.md) |
| tron-save | tronsave.io — GraphQL hybrid (platform + P2P); three parallel queries against `api-dashboard.tronsave.io/graphql`. | [README](../../src/plugins/trp-resource-markets/src/markets/tron-save/README.md) |
| tronify | Stub README — endpoint and market type not yet specified. | [README](../../src/plugins/trp-resource-markets/src/markets/tronify/README.md) |
| tronzap | tronzap.com — direct-recharge with volume tiers; POST `direct-recharge-info`, no auth, TRX-per-1000-energy pricing. | [README](../../src/plugins/trp-resource-markets/src/markets/tronzap/README.md) |
| zuuu | zuuu.io — single POST `/api/buy/buyinfo` returns flash/hourly/multi-day tiers; SUN-per-1-energy pricing. | [README](../../src/plugins/trp-resource-markets/src/markets/zuuu/README.md) |

## Further Reading

- [plugins.md](./plugins.md) — Plugin system overview, lifecycle, extension surfaces
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Package layout, manifests, the new-plugin walkthrough
- [trp-resource-markets/docs/markets.md](../../src/plugins/trp-resource-markets/docs/markets.md) — Market system architecture, normalization, fetcher discovery
