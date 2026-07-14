# Plugin Catalog

Index of every plugin shipped under `src/plugins/`.

## Why This Matters

Agents and operators routinely waste effort building features the platform already ships. Before scoping a new plugin, scan this catalog: a similar observer, admin surface, or service registry provider may already exist. Each plugin's colocated README is its canonical contract — this table only routes.

## Plugins

| Plugin | Purpose | README |
|--------|---------|--------|
| trp-address-labels | TRON address identity: entity attribution (CEX hot/cold/deposit wallets first) via source providers, curation gate, and the `address-labels` registry service, so feeds render "→ Binance" instead of raw addresses. | [README](../../src/plugins/trp-address-labels/README.md) |
| trp-ai-assistant | Admin-only Claude API console; streams answers and runs Batch jobs at 50% cost; other plugins register template variables and tools through the service registry. | [README](../../src/plugins/trp-ai-assistant/README.md) |
| trp-bazi-fortune | 八字命理 Four Pillars readings keyed off each wallet's on-chain `create_time`; daily Wu Xing fortune via Beijing-time pillars. | [README](../../src/plugins/trp-bazi-fortune/README.md) |
| trp-blog | Admin-authored public blog at `/blog`; AI-proposed posts held in the central curation queue, direct admin authoring at `/system/blog`. | [README](../../src/plugins/trp-blog/README.md) |
| trp-delegation-pools | Detects distributed energy pools by flagging delegations signed with permission ID ≥ 3; ranks operators by delegation volume. | [README](../../src/plugins/trp-delegation-pools/README.md) |
| trp-dust-tracker | Detects address-poisoning attacks; scores incoming dust against a 48h counterparty cache; rolls up to minute/hour/day/month. | [README](../../src/plugins/trp-dust-tracker/README.md) |
| trp-files | Platform-wide file inventory: one service, one collection, one upload policy; publishes `IFileService` as `'files'`. | [README](../../src/plugins/trp-files/README.md) |
| trp-forum | Wallet-signed posts (TronLink `signMessageV2`); shrinking randomly-positioned canvas, 7-day expiry, emoji reactions. | [README](../../src/plugins/trp-forum/README.md) |
| trp-image-gen | Admin-only image generation; pluggable provider backends (`NanoBananaProvider` first); publishes `IImageGenerationService` and registers per-provider AI tools. | [README](../../src/plugins/trp-image-gen/README.md) |
| trp-memo-tracker | Indexes UTF-8 memos across six contract types; live feed for everyone, search and history gated on verified wallet. | [README](../../src/plugins/trp-memo-tracker/README.md) |
| trp-reddit-bot | One content-router `publish` sink per subreddit (approved `core:social-post` fans out through curation + syndication) plus a read-only subreddit AI tool; credentials in admin-editable plugin config. | [README](../../src/plugins/trp-reddit-bot/README.md) |
| trp-resource-markets | Aggregates 18 TRON energy markets into one normalized `MarketSnapshot`; SUN-per-energy comparisons across hour/day/week rentals. Per-market fetcher catalog lives in the README. | [README](../../src/plugins/trp-resource-markets/README.md) |
| trp-resource-tracker | Observes `DelegateResourceContract` / `UnDelegateResourceContract`; raw retention 2d, summations 6mo, optional whale-delegation flagging. | [README](../../src/plugins/trp-resource-tracker/README.md) |
| trp-telegram-bot | Telegram webhook bot serving `/price` market lookups; IP allowlist, secret token, per-user rate limit. | [README](../../src/plugins/trp-telegram-bot/README.md) |
| trp-themes | Site-wide CSS theme management: admins create themes from a CSS template and enable any subset; every visitor sees the same result. | [README](../../src/plugins/trp-themes/README.md) |
| trp-trc10-authority | Authority on TRC10 token creation: observes `AssetIssueContract`, resolves new tokens against TronGrid, serves a public newest-tokens listing, and offers TronLink-based minting. | [README](../../src/plugins/trp-trc10-authority/README.md) |
| trp-whale-alerts | Whale transfer detection: `TransferContract` observer against an admin-configured threshold; `/whales` dashboard, homepage widget, `whale-alerts:large-transfer` WebSocket room. | [README](../../src/plugins/trp-whale-alerts/README.md) |
| trp-x-poster | Service-registry `x-poster` provider; `postTweet` (immediate or scheduled), `readTimelines`, image upload via X v1.1 media. | [README](../../src/plugins/trp-x-poster/README.md) |

## Further Reading

- [plugins.md](./plugins.md) — Plugin system overview, lifecycle, extension surfaces
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Package layout, manifests, the new-plugin walkthrough
- [trp-resource-markets/README.md](../../src/plugins/trp-resource-markets/README.md) — Market system architecture, normalization, per-market fetcher catalog
