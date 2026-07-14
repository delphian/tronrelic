# ClickHouse

`ClickHouseModule` implements `IModule`, managing the ClickHouse connection lifecycle and providing `IClickHouseService` (query/insert/exec) to other modules and plugins via `getClickHouseService()`.

## Canonical documentation

No dedicated detail doc exists yet; [system.md](../../../../docs/system/system.md) and [system-database.md](../../../../docs/system/system-database.md) cover MongoDB access patterns that ClickHouse complements for time-series and aggregation workloads. This module is optional: it skips initialization entirely when `CLICKHOUSE_HOST` is unset, and `getClickHouseService()` returns `undefined` in that case — callers must check before use. `ClickHouseBrowserController` (`api/clickhouse-browser.controller.ts`) exposes an admin browser over ClickHouse tables, gated by `requireAdmin`.
