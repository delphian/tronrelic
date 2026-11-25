# Address Explorer Module

Serves the data behind the `/a/<address>` page: history and analytics for any TRON address, read from the ClickHouse chain data and shown only to signed-in accounts. The core `TronAddress` chip's "View address" menu entry links every wallet address on the site here.

## Agent Quick Surface

| Surface | Value |
|---|---|
| Module id | `address-explorer` |
| Module class | `src/backend/modules/address-explorer/AddressExplorerModule.ts` |
| Service registry name | None. Nothing else consumes the page's reads |
| Mounted routes | `/api/address-explorer/*` (`createRateLimiter` 30 a minute per IP, then `requireLogin`) |
| Frontend page | `src/frontend/app/[lang]/(site)/(core)/a/[address]/page.tsx`, components in `src/frontend/modules/address-explorer/` |
| Chain reads | `IAddressActivityReader`, implemented by `AddressActivityReader` in `src/backend/modules/blockchain/chain-query/` |
| ClickHouse account | `address-explorer` (`tronrelic_address_explorer`), declared in the [ClickHouse Accounts module](../clickhouse-accounts/README.md); limits tuned on the ClickHouse tab of `/system/system` |
| Types | `packages/types/src/address-explorer/` |
| Owned storage | None |
| Scheduler jobs | None |
| Logs | `tronrelic:address-explorer` |
| Admin page | None. The module has no setting, job, or storage of its own; its only tunable, the ClickHouse account's limits, is on `/system/system` |

## Why a Module

The chip links every wallet address on the site to `/a/<address>`, so the page has to exist for the life of the process. A plugin can be disabled, which would leave every chip pointing at a 404.

## Access and Indexing

Every route requires a signed-in session. Each request runs ClickHouse queries, and keeping anonymous scrapers off them is the main reason for the login gate. Any signed-in account may look up any address, because the data is public chain history.

The page is `noindex, nofollow`, sent both as a robots meta tag and as an `X-Robots-Tag` header (`next.config.mjs`). `/a/` is deliberately **not** listed in `robots.txt`: a crawler that is refused a URL by `robots.txt` never sees its `noindex`, and Google can then list the bare URL from links elsewhere. A signed-out crawler receives only the page header and a sign-in prompt, which costs no ClickHouse query.

## How the Page Is Read

`AddressExplorerService` turns a page load into a sequence of bounded reads through the injected reader.

| Section | Read | Span |
|---|---|---|
| Summary | `reader.profile` — totals, breakdown by token and direction, lookalike counterparties | The visitor's choice of 24h, 7d (default), or 21d |
| Counterparties | `reader.counterparties` — the 25 busiest counterparty, token, and direction groups | Same |
| Transfers | `reader.transfers` — 50 movements a page, newest first | One week a page, back to the start of retention |
| Delegations | `reader.delegations` — the newest 50 events, both resources | The visitor's choice |
| Permission changes | `reader.permissions` — the newest 50 updates | The visitor's choice |

Three rules shape those reads.

**A 21-day read too large for the wallet falls back to 7 days.** The reader reports a read stopped by a size limit or by the 25-second reading deadline as `too-large`. The service then reads the section over 7 days and sets `narrowedFrom: '21d'` on it, and the page says so. A 7-day or 24-hour read that is too large is reported as an error rather than narrowed further.

**Transfers are read a week at a time.** A 21-day newest-first read of a busy wallet would scan its whole history to sort it, so the list never reads more than a week. Each page returns `next`, either a position inside the same week or the end of the next older week. A request that finds an empty week moves straight on to the next one, up to three weeks, so "Load older" always shows rows or reaches the end.

**Reads run one after another.** The ClickHouse account allows four queries at once across every visitor. Running a page's five sections in parallel would let one visitor fill every slot. A read refused because the slots were full is retried once after half a second; a used-up hourly quota is not retried.

## Reuse of the Chain Query Tools

The reader is the blockchain module's `AddressActivityReader`. It builds private instances of five wallet AI tools — `blockchain-address-profile`, `blockchain-address-counterparties`, `blockchain-address-transfers`, `blockchain-resource-delegations`, and `blockchain-permission-changes` — and calls their handlers directly, so the page and the AI tools share one copy of each query. The instances are never registered on the AI tool registry. They differ from the registered tools in two ways:

- They read as the `address-explorer` ClickHouse account (`createChainQueryToolkit(..., { accountId })`), so page visitors and AI agents cannot use up each other's limits.
- Reads narrowed to one address may span the whole retention (`IChainQueryToolOptions.addressWindowRules`), where the registered tools stop at a week per call. Chain-wide reads keep the tools' own caps.

The reader charges every read to the visitor's Better Auth user id as the ClickHouse quota key, so the account's hourly limits apply to each visitor separately. It copies only the fields the page renders out of each tool's envelope, dropping the cost report and the notes written for a model, and maps the tool's `errorKind` and `errorReason` to an `AddressExplorerErrorReason`.

| Tool failure | Page reason |
|---|---|
| `limit` with `size` or `deadline` | `too-large` |
| `limit` with `quota` | `quota` |
| `limit` with `concurrency` | `busy` |
| `unavailable` (no ClickHouse, or the account is not active) | `unavailable` |
| `input` or `failed` | `failed` (logged as a warning by the blockchain module) |

## REST API

Both routes return 400 for an invalid address and 401 without a session. Each section succeeds or fails on its own, so a 200 response can still carry failed sections.

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/address-explorer/:address` | `period` = `24h`, `7d` (default), or `21d` | `{ overview: IAddressExplorerOverview }` |
| GET | `/api/address-explorer/:address/transfers` | `before` (ISO time) and optional `cursor`, both copied from the previous page's `next` | `{ transfers: AddressExplorerSection<IAddressExplorerTransfers> }` |

`:address` accepts base58 or hex and is checksum-verified with `toVerifiedBase58`. A `cursor` must be base64url text of at most 2,048 characters and needs `before`.

## Source Map

| Path | Responsibility |
|---|---|
| `AddressExplorerModule.ts` | Lifecycle: builds the service in `init()`, mounts the router in `run()` |
| `services/AddressExplorerService.ts` | Section order, the 21-to-7-day fallback, week-by-week transfers, the busy retry |
| `api/AddressExplorerController.ts` | Request validation and responses |
| `api/createAddressExplorerRouter.ts` | Route declarations |
| `__tests__/` | Lifecycle tests and service tests against a fake reader |

## Bootstrap

`src/backend/index.ts` builds the reader with `createAddressActivityReader(serviceRegistry, ADDRESS_EXPLORER_ACCOUNT_ID)` and passes it to `init()`. The reader resolves the ClickHouse accounts, address tags, and price history services from the registry on each call, so neither phase depends on those modules having started.

## Further Reading

- [system-chain-query-tools.md](../../../../docs/system/system-chain-query-tools.md) — the tools whose queries the page reuses, their envelope, and cost guidance
- [system-chain-data-clickhouse.md](../../../../docs/system/system-chain-data-clickhouse.md) — the `tron` database and its 21-day retention
- [ClickHouse Accounts README](../clickhouse-accounts/README.md) — the `address-explorer` account and its limits
