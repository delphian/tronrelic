# Analytics

Legacy transaction-analytics surface: `TransactionAnalyticsService` (high-amount and latest-by-type queries over `transactions`), `AccountAnalyticsService` (per-account transaction history), `FlowAnalyticsService` (inflow/outflow totals and series), `CalculatorService` (energy-estimate calculator), and `MemoService` (`transaction_memos` reads) — each Redis-cached via the shared `CacheService`.

## Canonical documentation

No dedicated detail doc exists yet; [system-database.md](../../../../docs/system/system-database.md) covers the `IDatabaseService`/model-registration and caching patterns every service here follows. This directory is distinct from the `tools` module's own `CalculatorService` (see [Tools Module README](../tools/README.md)) — the two are separate implementations, not shared code.
