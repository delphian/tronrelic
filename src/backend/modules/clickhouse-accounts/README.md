# ClickHouse Accounts

Provisions ClickHouse users so that different kinds of caller reach ClickHouse under limits the server enforces, and gives admins configuration, an audit trail, and usage history for each one. The first managed account is `ai-agent`, a read-only user for AI tools that read the `tron` chain database.

A **ClickHouse account** here is a ClickHouse user together with its settings profile (per-query limits) and quota (per-hour limits). A **managed** account is created and maintained by this module. An **observed** account is only reported on.

| Surface | Value |
|---|---|
| Module id | `clickhouse-accounts` |
| Registry name | `'clickhouse-accounts'` → `IClickHouseAccountService` |
| Admin API | `/api/admin/system/clickhouse-accounts` (`requireAdmin`; changes also `requireAdminUser`) |
| Admin UI | The ClickHouse tab of `/system/system` |
| Types | `packages/types/src/clickhouse/IClickHouseAccount*.ts`, `IClickHouseReader.ts` |
| MongoDB | `module_clickhouse-accounts_limits`, `module_clickhouse-accounts_audit` |
| ClickHouse | `tronrelic.clickhouse_account_usage_daily` (365-day TTL) |
| Scheduler | `clickhouse-accounts:rollup-usage`, hourly at :07 |
| Logs | `tronrelic:clickhouse-accounts` |

## Why This Exists

Without it, every ClickHouse caller connects as the `default` user, which has full rights and no query limits. An AI agent composing chain queries through that user could scan whole tables, hold the connections the chain writer needs, and slow the server that block sync writes to. Limits written in tool code only hold as long as that code has no bugs. Limits in a ClickHouse settings profile and quota hold regardless, because the server checks every query against them.

## Source Map

| File | Responsibility |
|---|---|
| `ClickHouseAccountsModule.ts` | Lifecycle: storage in `init()`; apply, publish, mount, and job in `run()` |
| `services/buildAccountDefinitions.ts` | The declared accounts, their grants, default limits, and ceilings |
| `services/buildAccountSql.ts` | Pure builders for the user, profile, quota, and grant statements |
| `services/mergeLimitPatch.ts` | Validates an admin's change against the ceilings |
| `services/ClickHouseAccountService.ts` | The singleton behind the registry name |
| `services/ClickHouseAccountStore.ts` | Stored limits and the audit trail |
| `services/ClickHouseAccountInspector.ts` | Server-reported settings, grants, quota usage, running and recent queries, kill |
| `services/ClickHouseAccountUsageRollup.ts` | Daily per-user totals copied out of `system.query_log` |
| `api/` | Thin controller and router |

## Declared Accounts

Accounts are declared in `buildAccountDefinitions.ts`, not created from the admin page. An account only matters if some code connects as it, and its grants decide what it can read, so both go through code review. The admin page tunes limits up to the declared ceilings.

| Id | ClickHouse user | Kind | Grants |
|---|---|---|---|
| `default` | `CLICKHOUSE_USER` | Observed | Whatever the server gives it |
| `ai-agent` | `tronrelic_ai_agent` | Managed | `SELECT` on `tron.*` |

`default` stays observed. The chain writer, migrations, table creation, and the admin table browser use it, and a limit that stopped one of the writer's inserts would leave a gap in the chain data. For the same reason its queries cannot be stopped from the admin page.

## What a Managed Account Enforces

| Limit field | ClickHouse setting or quota | `ai-agent` default | Ceiling |
|---|---|---|---|
| `maxExecutionSeconds` | `max_execution_time` | 10 | 60 |
| `maxRowsToRead` | `max_rows_to_read` | 50M | 500M |
| `maxBytesToRead` | `max_bytes_to_read` | 5 GB | 50 GB |
| `maxMemoryBytes` | `max_memory_usage` | 1 GB | 4 GB |
| `maxThreads` | `max_threads` | 2 | 8 |
| `maxResultRows` | `max_result_rows` | 5,000 | 100,000 |
| `maxConcurrentQueries` | `max_concurrent_queries_for_user` | 2 | 8 |
| `hourlyQueries` | quota `queries` | 600 | 5,000 |
| `hourlyReadRows` | quota `read_rows` | 2B | 20B |
| `hourlyExecutionSeconds` | quota `execution_time` | 600 | 3,600 |

Each numeric setting is written `MIN 1 MAX <value>`. `MAX` stops a caller raising it for one query. `MIN 1` stops a caller switching it off, because ClickHouse reads 0 as "no limit" for these settings. The profile also fixes `readonly = 2`, the `throw` overflow modes (so a limit fails a query rather than returning a partial result that looks complete), and `cancel_http_readonly_queries_on_client_close = 1` (so aborting a request stops the query on the server).

The quota is keyed `client_key, user_name`: a caller passing `quotaKey`, such as an agent run id or an end-user id, gets a budget per key. Because keys are chosen by the caller, the quota does not cap the account's total load. `maxConcurrentQueries` does: however many keys are used, no more than that many of the account's queries run at once.

## Passwords

Account passwords are never stored. `ClickHouseService` derives each one as an HMAC of the account id keyed by `CLICKHOUSE_PASSWORD`, and hands this module only its SHA-256 hash for `IDENTIFIED WITH sha256_hash`. The password never appears in SQL text, error logs, or ClickHouse's query log. Rotating `CLICKHOUSE_PASSWORD` rotates every account password the next time the accounts are applied, which happens at startup. With an empty root password, as in local development, derived passwords are predictable, and the module logs a warning.

## Lifecycle

`init()` creates the MongoDB indexes and the usage table, and builds the service. With `CLICKHOUSE_HOST` unset it does nothing, like the ClickHouse module.

`run()` applies every managed account: create-if-missing then alter the profile, user, grants (revoke all, then grant the declared ones), and quota, using stored limits where an admin set them and defaults otherwise. A stored limit above a lowered ceiling is applied at the ceiling, with a warning. A failed apply marks the account `error` rather than stopping startup, because ClickHouse is optional here. The admin page shows the error, and `reader()` refuses the account until it is applied again. The root user needs access management rights, which `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` in the compose files provides.

## Service Contract

`IClickHouseAccountService`, published as `'clickhouse-accounts'`:

| Method | Behaviour |
|---|---|
| `listAccounts()` / `getAccount(id)` | Summary with state, stored limits, ceilings, and the settings and grants read back from ClickHouse |
| `updateLimits(id, patch, actorId, reason)` | Validates against ceilings, applies, then stores. Audited on success and failure. 400 invalid, 409 observed, 502 refused by ClickHouse, 500 applied but not stored (audited with that detail) |
| `applyAccount(id, actorId)` | Full re-apply, audited. The summary reports the outcome |
| `listQueries(id, 'running' \| 'recent', limit)` | From `system.processes` or `system.query_log` |
| `killQuery(id, queryId, actorId)` | Managed accounts only; checks the query belongs to the account first. Audited |
| `getQuotaUsage(id)` | Current interval per quota key |
| `getUsageHistory(id, days)` | Daily totals, up to 365 days |
| `listAudit(id, limit)` | Newest first |
| `reader(id)` | Shared `IClickHouseReader` for an active managed account; throws otherwise |

A consumer reads under an account's limits like this:

```typescript
const accounts = serviceRegistry.get<IClickHouseAccountService>('clickhouse-accounts');
const reader = accounts?.reader('ai-agent');
const result = await reader?.query<{ n: string }>(
    'SELECT count() AS n FROM transaction WHERE block_timestamp > {since:DateTime64(3)}',
    { since },
    { quotaKey: runId, queryId: auditId }
);
// result.readRows feeds a per-run budget; result.queryId finds the row in system.query_log.
```

The reader connects with the account's `defaultDatabase`, so unqualified names resolve in `tron`.

## Admin API

| Route | Gate | Returns |
|---|---|---|
| `GET /` | admin | `{ accounts }` |
| `GET /:id` | admin | `{ account }` |
| `PUT /:id/limits` | admin user | `{ account }`; body `{ limits, reason? }` |
| `POST /:id/apply` | admin user | `{ account }` |
| `GET /:id/queries?scope=running\|recent&limit=` | admin | `{ queries }` |
| `POST /:id/queries/:queryId/kill` | admin user | `{ killed }` |
| `GET /:id/usage?days=` | admin | `{ quota, history }` |
| `GET /:id/audit?limit=` | admin | `{ entries }` |

"Admin user" routes add `requireAdminUser`, which refuses the shared `ADMIN_API_TOKEN` so every change is attributed to a signed-in admin.

## Accountability Data

| Question | Source | Kept |
|---|---|---|
| What is it running now? | `system.processes` | Live |
| What did it run recently, and what failed? | `system.query_log` | 3 days (`configs/clickhouse/system-logs-ttl.xml`) |
| How has its usage changed? | `clickhouse_account_usage_daily` | 365 days |
| Who changed its limits, and why? | `module_clickhouse-accounts_audit` | Indefinitely |

The rollup recomputes the last three days for every ClickHouse user each hour, so a missed run is filled in by the next. It counts limit hits (error codes in `limitErrorCodes.ts`) and denials separately from other failures. The inspector's own reads run as `default`, so they appear in that account's recent queries.
