# Valuation Module

Computes per-user **portfolio** summaries — net worth, holdings, allocation, realized/unrealized PnL, and USD balance-over-time — by joining three local data layers (the transaction ledger, the daily price series, the balance snapshots) entirely from storage. Never a live fetch. This is the implemented form of the surface account-history reserved as `IWalletValuationSummary`.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `valuation` |
| Module class | `src/backend/modules/valuation/ValuationModule.ts` |
| Service registry name | `'valuation'` → `IValuationService` |
| Mounted routes | `/api/valuation/me/*` (`createRateLimiter` + `requireLogin`, ownership-scoped) |
| Scheduler jobs | none (compute-on-read) |
| Owned storage | none — joins `'account-history'`, `'price-history'`, and identity `'wallets'` |
| Types package | `@delphian/tronrelic-types` → `IValuationService`, `IPortfolioSummary`, `IPortfolioHolding`, `IPortfolioQuery` |
| Bootstrap order | Inits after price-history; resolves its data services lazily from the registry, so order is not load-bearing |

## The Scope Rule (Why This Is Per-User)

Cost-basis PnL is inherently **per user**, not per wallet: moving a token between two wallets the same user owns is neither a disposal nor an acquisition. Every query carries both the in-scope `addresses` (one wallet for the zoom, all for the aggregate) **and** the full `ownedAddresses` set, which classifies each transfer's counterparty as *internal* or *external* (a real acquisition/disposal).

The engine keeps lots in **per-wallet (segregated) sub-books** and treats an *internal* transfer as a **basis migration**: the source wallet's consumed lots move, basis intact, into the receiving wallet's sub-book (matched by `txId`). A sale therefore draws on the *selling* wallet's own basis, never a global pool, so per-user figures are exactly the **sum** of the per-wallet figures — coherent and additive. The service walks the **full owned set's** ledgers even for a single-wallet zoom (basis can only migrate in if the source ledger is read); holdings come only from the report-scope snapshots. Single-address explorers cannot do this — they book a phantom gain on the receiving side of every internal transfer.

Each wallet's ledger read is bounded (`MAX_LEDGER_ROWS`, newest-first), so a high-volume wallet can push one leg of a migration past its window while the other leg stays inside another wallet's. The service detects that split — a `txId|asset` whose in and out quantities, summed across the owned set, disagree — and refetches the missing legs by hash via `getTransactionsByTxIds`, rebuilding the pair so basis is never silently dropped. A transfer whose *both* legs are beyond their windows stays invisible, which is the pre-existing deep-history approximation below, not a split.

## Source Map

| Path | Responsibility |
|------|----------------|
| `ValuationModule.ts` | Lifecycle; constructs the service, mounts the user router, publishes `'valuation'` |
| `services/valuation.service.ts` | `ValuationService` singleton — reads the three layers, builds moves, drives the engine, assembles the summary |
| `lib/lot-engine.ts` | Pure FIFO cost-basis (`computeLots`) + snapshot-anchored balance reconstruction (`reconstructTrxBalanceSeries`); no I/O |
| `api/valuation-user.controller.ts` | Login-gated handlers; resolves the owned set, enforces the 404-on-unowned gate |
| `api/valuation-user.routes.ts` | Router factory (guards applied at mount) |

## Published Contract — `'valuation'` → `IValuationService`

| Method | Purpose |
|--------|---------|
| `getPortfolio({ addresses, ownedAddresses, scope })` | The full `IPortfolioSummary` for a scope. Trusts the addresses; the caller authorizes. |

## REST Endpoints (`requireLogin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/valuation/me/portfolio` | Aggregate portfolio across the caller's verified wallets (scope `user`) |
| GET | `/api/valuation/me/wallets/:address/portfolio` | One owned wallet (scope `wallet`); 404 if unowned |

## Division of Truth (and Its Limits)

Current **holdings and net worth** come from the latest balance *snapshot* — the absolute on-chain truth, including staked TRX the ledger cannot reconstruct. **Realized/unrealized PnL and cost basis** come from the *lot engine* walking the ledger against historical prices. The two can diverge for accounts whose oldest history TronGrid cannot reach (a disposal with no recorded acquisition realizes against zero basis); the snapshot keeps headline net worth correct regardless.

Documented v1 simplifications: all inbound external transfers are treated as acquisitions at the day's price (airdrops are not distinguished from buys); fees are excluded from PnL (they affect net worth via the snapshot); the balance-over-time series is TRX-anchored over the trailing window (tokens contribute to current net worth, not the historical curve); tokens with no local price coverage appear by quantity and are excluded from USD totals (`unpricedAssets`).

## Related

- [Account History Module README](../account-history/README.md) — the ledger and the balance snapshots this consumes
- [Price History Module README](../price-history/README.md) — the daily USD price series this consumes
- [Identity Module README](../identity/README.md) — the `'wallets'` service that resolves the owned set
