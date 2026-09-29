# Analytics

Legacy transaction-analytics surface: `TransactionAnalyticsService` (high-amount and latest-by-type queries over `transactions`), `AccountAnalyticsService` (per-account transaction history), `FlowAnalyticsService` (inflow/outflow totals and series), `CalculatorService` (energy-estimate calculator), and `MemoService` (`transaction_memos` reads) — each Redis-cached via the shared `CacheService`.

## Request bounds

The inflow/outflow endpoints (`/api/inflows/*`, `/api/outflows/*`) are public, so `flow.controller.ts` refuses a `startDate`–`endDate` span wider than 366 days, or a non-finite timestamp, with a 400 during parsing. The series path builds one bucket per day across the range in a synchronous loop, and an unbounded range from an anonymous caller would otherwise block the event loop and exhaust memory. Every public router mounting these controllers wraps them in `asyncHandler`, because Express 4 does not catch a rejected async handler, and a `zod` parse failure left unwrapped terminates the process.

## Canonical documentation

No dedicated detail doc exists yet; [system-database.md](../../../../docs/system/system-database.md) covers the `IDatabaseService`/model-registration and caching patterns every service here follows. This directory is distinct from the `tools` module's own `CalculatorService` (see [Tools Module README](../tools/README.md)) — the two are separate implementations, not shared code.
