# Valuation Module

Computes per-user **portfolio** summaries — net worth, holdings, allocation, realized/unrealized PnL, and USD balance-over-time — by joining three local data layers (the transaction ledger, the daily price series, the balance snapshots) entirely from storage. Never a live fetch. This is the implemented form of the surface account-history reserved as `IWalletValuationSummary`.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `valuation` |
| Module class | `src/backend/modules/valuation/ValuationModule.ts` |
| Service registry name | `'valuation'` → `IValuationService` |
| Mounted routes | `/api/valuation/me/*` (`createRateLimiter` + `requireLogin`, ownership-scoped); `/api/admin/system/valuation/*` (`createAdminRateLimiter` + `requireAdmin`) |
| Scheduler jobs | none (compute-on-read) |
| Owned storage | none — joins `'account-history'`, `'price-history'`, identity `'wallets'`, and identity `'user-settings'` (balance-range override only) |
| Types package | `@delphian/tronrelic-types` → `IValuationService`, `IPortfolioSummary`, `IPortfolioHolding`, `IPortfolioQuery` |
| Bootstrap order | Inits after price-history; resolves its data services lazily from the registry, so order is not load-bearing |

## The Scope Rule (Why This Is Per-User)

Cost-basis PnL is inherently **per user**, not per wallet: moving a token between two wallets the same user owns is neither a disposal nor an acquisition. Every query carries both the in-scope `addresses` (one wallet for the zoom, all for the aggregate) **and** the full `ownedAddresses` set, which classifies each transfer's counterparty as *internal* or *external* (a real acquisition/disposal).

The engine keeps lots in **per-wallet (segregated) sub-books** and treats an *internal* transfer as a **basis migration**: the source wallet's consumed lots move, basis intact, into the receiving wallet's sub-book (matched by `txId`). A sale therefore draws on the *selling* wallet's own basis, never a global pool, so per-user figures are exactly the **sum** of the per-wallet figures — coherent and additive. The service walks the **full owned set's** ledgers even for a single-wallet zoom (basis can only migrate in if the source ledger is read); holdings come only from the report-scope snapshots. Single-address explorers cannot do this — they book a phantom gain on the receiving side of every internal transfer.

Each wallet's ledger read is uncapped, newest-first, paged by a keyset cursor until a short page ends it — every owned address's full ledger is read, so an internal transfer's two legs are always both present in the same computation; there is no per-wallet window for a leg to fall outside of. The cursor, not an `offset`, is what makes this safe under concurrent ingestion: account-history's forward-sync job can insert newer legs mid-scan, and a coarse timestamp is not a unique sort key (one transaction can emit several legs sharing it), so an offset window would shift and silently duplicate or skip legs at a page boundary. The remaining approximation is upstream of this service: TronGrid's own fingerprint paging cannot reach the deepest history of very large accounts, so a transfer entirely beyond what account-history has ingested stays invisible regardless.

## Source Map

| Path | Responsibility |
|------|----------------|
| `ValuationModule.ts` | Lifecycle; constructs the service, mounts the user router, publishes `'valuation'` |
| `services/valuation.service.ts` | `ValuationService` singleton — reads the three layers, builds moves, drives the engine, assembles the summary |
| `lib/lot-engine.ts` | Pure FIFO cost-basis (`computeLots`) + snapshot-anchored balance reconstruction (`reconstructTrxBalanceSeries`); no I/O |
| `api/valuation-user.controller.ts` | Login-gated handlers; resolves the owned set, enforces the 404-on-unowned gate |
| `api/valuation-user.routes.ts` | Router factory (guards applied at mount) |
| `api/valuation-admin.controller.ts` | Admin handlers for the per-wallet balance-range override |
| `api/valuation-admin.routes.ts` | Admin router factory (guards applied at mount) |

## Published Contract — `'valuation'` → `IValuationService`

| Method | Purpose |
|--------|---------|
| `getPortfolio({ userId, addresses, ownedAddresses, scope })` | The full `IPortfolioSummary` for a scope. Trusts the addresses; the caller authorizes. `userId` resolves the balance-range override below, never authorization. |

## REST Endpoints (`requireLogin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/valuation/me/portfolio` | Aggregate portfolio across the caller's verified wallets (scope `user`) |
| GET | `/api/valuation/me/wallets/:address/portfolio` | One owned wallet (scope `wallet`); 404 if unowned |

## REST Endpoints (`requireAdmin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/system/valuation/users/:userId/wallets/:address/balance-range` | Effective range for one wallet — the stored override, or `'1y'`. 404s if `userId` doesn't exist or doesn't own `address` |
| PATCH | `/api/admin/system/valuation/users/:userId/wallets/:address/balance-range` | Body `{ range: '1y' \| 'all' }`. Setting `'1y'` clears the override; setting `'all'` stores it. Same 404 ownership check as the GET |

## Balance-Chart Range: Default and Admin Override

The balance-over-time chart defaults every wallet to a trailing year (`DEFAULT_BALANCE_WINDOW_DAYS = 365` in `valuation.service.ts`). An admin can widen a specific wallet to unbounded — the series then starts at the earliest ledger delta instead of a fixed floor, an honest "as far back as this ledger reaches," never a claim of the account's true genesis (TronGrid's own fingerprint paging cannot reach the deepest history of very large accounts regardless of this setting).

The override is stored in the identity module's `'user-settings'` store — namespace `'valuation'`, keyed by wallet address, value `'1y' | 'all'` — through the *trusted* programmatic `set`/`get`/`delete` path, never the self-service `/api/user/settings` surface. That distinction is deliberate: it keeps the override admin-only, since a user widening their own window would defeat the point of a default. One resolved window covers the whole query (aggregate or zoom) because the series is a single reconstructed curve, not stitched per wallet — if any wallet in scope is set to `'all'`, the combined view widens too, which never exposes data the caller was not already entitled to see.

`IPortfolioSummary.historyBackfillComplete` flags whether every report-scope address has finished account-history's ledger backfill (`getProgressFor` status `'complete'`). The back-solve reconstructs from today's snapshot across whatever deltas the ledger holds, so a day missing purely because ingestion hasn't reached it yet — not because nothing happened — still shifts the whole curve, widened window or not. The frontend caveats the chart when this is `false` rather than presenting an in-progress backfill as a settled history.

## Division of Truth (and Its Limits)

Current **holdings and net worth** come from the latest balance *snapshot* — the absolute on-chain truth, including staked TRX the ledger cannot reconstruct. **Realized/unrealized PnL and cost basis** come from the *lot engine* walking the ledger against historical prices. The two can diverge for accounts whose oldest history TronGrid cannot reach (a disposal with no recorded acquisition realizes against zero basis); the snapshot keeps headline net worth correct regardless.

**Fees and rewards are in PnL.** The ledger's `fee` legs consume lots as a pure basis loss (no proceeds — burned TRX is destroyed, not sold, so no phantom market-price gain), and `reward` legs (claimed vote income) are external acquisitions at the day's price. Unclaimed rewards from the snapshot's `withdrawableRewardSun` count toward net worth. Staking legs never reach the engine — they are intra-account bucket moves, and snapshots carry the buckets.

**Approximation is labelled, not silent.** `IPortfolioSummary.basisApproximate` is true when the walk hit a zero-basis disposal or an undrained internal migration — evidence the ledger does not reach far enough back — so the UI marks PnL/cost-basis as approximate while net worth (snapshot-derived) stays exact.

**Token metadata and stablecoins.** Display symbols and decimals come from account-history's `getTokenMetadata` registry (observed on-chain `token_info`), with ledger-observed decimals authoritative and `DEFAULT_TOKEN_DECIMALS` only a last resort. Known stablecoins (USDT, USDC) with a missing price day pin to $1 — but only when their nearest real price does not dispute the peg beyond `STABLECOIN_DEPEG_TOLERANCE`, so a genuine depeg is never papered over.

Remaining v1 simplifications: all inbound external transfers are treated as acquisitions at the day's price (airdrops are not distinguished from buys); the balance-over-time series is TRX-anchored (tokens contribute to current net worth, not the historical curve); non-stablecoin tokens with no local price coverage appear by quantity and are excluded from USD totals (`unpricedAssets`).

## Related

- [Account History Module README](../account-history/README.md) — the ledger and the balance snapshots this consumes
- [Price History Module README](../price-history/README.md) — the daily USD price series this consumes
- [Identity Module README](../identity/README.md) — the `'wallets'` service that resolves the owned set
