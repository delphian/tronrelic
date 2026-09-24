# ClickHouse

`ClickHouseModule` implements `IModule`, managing the ClickHouse connection lifecycle and providing `IClickHouseService` (query/insert/exec) to other modules and plugins via `getClickHouseService()`.

Inserts run as async inserts by default (`async_insert: 1`, `wait_for_async_insert: 0`), which suits many tiny writes such as traffic events. `insert()` takes `IClickHouseInsertOptions` to change that for one call: `waitForCommit: true` waits until the server's async buffer has been written, so a thrown error means the rows did not persist, and `synchronous: true` skips the buffer and stores the rows directly. Use `synchronous` for rows the caller has already batched. Waiting on the buffer holds one of the client's ten pooled connections for up to a few hundred milliseconds, and a caller sending several such inserts at once can fill the pool for every other caller.

## Canonical documentation

No dedicated detail doc exists yet; [system.md](../../../../docs/system/system.md) and [system-database.md](../../../../docs/system/system-database.md) cover MongoDB access patterns that ClickHouse complements for time-series and aggregation workloads. This module is optional: it skips initialization entirely when `CLICKHOUSE_HOST` is unset, and `getClickHouseService()` returns `undefined` in that case — callers must check before use. `ClickHouseBrowserController` (`api/clickhouse-browser.controller.ts`) exposes an admin browser over ClickHouse tables, gated by `requireAdmin`. Unscoped, `GET /stats` is the universal listing: every table in every database except ClickHouse's own (`system`, `INFORMATION_SCHEMA`), each reported with its `database`, so data kept outside the application database, such as the `tron` chain data, appears beside the application's tables. It scopes the list server-side, to the application database only, by either `?prefix=` (plugins, through `pluginPrefix()`) or repeated `?tables=` exact names (core modules, whose tables share no prefix); `tables` wins when both are sent, and an empty `tables` returns 400 rather than the whole inventory. `GET /tables/:name/rows` takes an optional `?database=`, defaulting to the application database, refuses ClickHouse's own databases, and validates both names against `system.tables` before either is written into the query.

## Plugin-scoped access

Plugins do not receive `IClickHouseService`. They receive `IPluginClickHouseService` (`services/plugin-clickhouse.service.ts`), one instance per plugin, built during plugin loading — the same arrangement `PluginDatabaseService` gives them for MongoDB. It is not a singleton, because each plugin gets its own namespace.

| Method | Behaviour |
|---|---|
| `table(logicalName)` | Resolves to the backtick-quoted physical name, e.g. `` `plugin_dust-tracker_dust` `` |
| `prefix()` | The unquoted `plugin_<id>_`, for comparing against `system.tables.name` |
| `insert(logicalTable, rows, options?)` | Prefixes the table, then delegates |
| `query`, `exec`, `ping` | Pass through unchanged |

Both stores share one namespace rule, `pluginPrefix()` in the types package: `plugin_<manifest.id>_` with the identifier kept verbatim, hyphens included. Keeping the hyphen is what makes the scheme sound — `_` delimits the id from the name after it, and a plugin id may not contain `_`, so no plugin's prefix can be the opening of another's.

`table()` returns a quoted name because that is not optional here. A physical name such as `plugin_dust-tracker_dust` is not a legal unquoted ClickHouse identifier, and `@clickhouse/client` interpolates a table name into the statement without escaping it. That same absence of escaping is why `PLUGIN_ID_PATTERN` gating `manifest.id` at load is a security control, not a style rule.

`query` and `exec` pass through because a table name inside an opaque SQL string cannot be rewritten without parsing SQL. A plugin can therefore still read another plugin's tables, exactly as it could when plugins shared the raw client. This is ergonomics, not isolation.
