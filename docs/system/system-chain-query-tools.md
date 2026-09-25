# Chain Query AI Tools

Five read-only AI tools let an agent walk TronRelic's ClickHouse copy of the TRON chain: profile a wallet, list its transfers and counterparties, follow funds across several hops, and look at one token's activity across the whole chain. They live in `src/backend/modules/blockchain/chain-query/` and read the `tron` database described in [system-chain-data-clickhouse.md](./system-chain-data-clickhouse.md).

## Why This Matters

Public chain APIs such as TronGrid and TronScan are built for wallets and explorers. They page through one address at a time, cut results short without saying so, return the same empty list for "nothing happened" and "we do not have that data", and leave amount conversion to the caller. An agent working through them spends dozens of calls per question and gets decimals wrong by factors of a million.

These tools answer the questions agents actually ask in one call each, and every response states its own limits. They also run under the `ai-agent` ClickHouse account, whose per-query limits and hourly quota ClickHouse enforces on the server. A mistaken or injected model can ask for too much, but it cannot make ClickHouse do too much. See the [ClickHouse Accounts README](../../src/backend/modules/clickhouse-accounts/README.md).

## The Tools

| Tool | Answers | Window (default / max) |
|---|---|---|
| `blockchain-address-profile` | Totals for one wallet, a breakdown per token and direction including zero-value counts, its tags, and groups of lookalike counterparties | 168h / 168h |
| `blockchain-address-counterparties` | One row per counterparty, direction, and token: transfer and transaction counts, total, first and last seen, poisoning flag | 24h / 168h |
| `blockchain-address-transfers` | Individual movements, newest first, filtered by direction, token, counterparty, and minimum amount, paged by cursor | 24h / 168h |
| `blockchain-trace-flow` | A graph of one token's funds forward or backward from a wallet, up to 3 hops | 24h / 168h |
| `blockchain-token-activity` | Top senders, top receivers, or hourly volume for one token across the chain | 24h / 24h |

All five declare `read` / `internal` with `surfacesUntrustedContent`, because token symbols and names are chosen by whoever deployed the contract. The governor therefore wraps every result as data before the model sees it. `internal` rather than `public` is because results carry operator-assigned address tags.

A token filter accepts `TRX`, a TRC-20 contract address, or a TRC-10 id. A symbol such as `USDT` is refused, because any contract can answer `symbol()` with `USDT` and address poisoning relies on exactly that.

## How It Works

### One session per call

`runChainQueryTool` opens a `ChainQuerySession` for each call. The session reads through `IClickHouseAccountService.reader('ai-agent')` and does three things on top of the account's limits:

- **It charges reads to the run.** The governor passes each handler an `IToolHandlerContext` (see [system-ai-tools.md](./system-ai-tools.md#the-tool-contract)), and the session sends its `queryId` as the ClickHouse quota key, so each agent run has its own hourly budget. When a run has no `queryId`, the session sends its `conversationId` instead, so every run in that conversation shares one hourly budget. With neither, no key is sent and the call draws on the budget the `ai-agent` account shares with every other unkeyed call.
- **It adds up the cost.** Queries, rows and bytes read, and the ClickHouse query ids go into every response's `cost`, which comes first in the object so the governor's short audit digest still contains the ids.
- **It cancels its own reads after 25 seconds.** That is under the governor's 30-second handler budget, so a slow query is cancelled on the server and reported with advice rather than left running after the governor gives up waiting.

`ChainQuerySession.translate` turns ClickHouse limit errors (`TOO_MANY_ROWS`, `TIMEOUT_EXCEEDED`, `QUOTA_EXCEEDED`, and the rest) into a message telling the model how to ask for less. Any other error is logged in full and reported without SQL or server detail.

### The response envelope

Every response is built by `buildChainResponse` and carries the same fields.

| Field | Contents |
|---|---|
| `success`, `cost` | Outcome and what the reads cost. A failure carries `error` and `errorKind` (`input`, `limit`, `unavailable`, or `failed`) instead of a payload |
| `window` | The time range actually answered for. A start older than retention is moved forward and noted |
| `coverage` | Expected, present, and missing blocks in the window, blocks without receipts, where the stored data starts and ends, and `complete` |
| payload | The tool's own fields, with `truncated` and `nextCursor` where it pages. A cursor carries the first page's window, so later pages answer for that same window even when it was given as `hours` counted back from now |
| `tokens` | Decimals, symbol, name, and status for every token the payload mentions, keyed by `TRX`, TRC-10 id, or contract address |
| `addressTags` | Active tags, such as `ofac:sdn`, for every mentioned address that has any |
| `notes` | Caveats for this particular answer, derived from the fields above so a tool cannot forget one |

Coverage is computed from `tron.block` rather than `tron._ingest_gap`, because a missing height is missing whatever the reason. That includes the one loss the gap table cannot record. A window ending within five minutes of now may run up to five minutes past the newest stored block before coverage counts as short, because blocks reach ClickHouse only after the emit buffer releases them, about a minute behind the chain by default. A window that ended earlier than that is held to about three blocks at its end, the same as at its start, so a missing tail of blocks is reported rather than hidden. Coverage is cached for a minute per exact window, so a later page or several calls over the same `since`/`until` pay for it once.

### Amounts, prices, and tags

Every amount is `{ raw, value }`: base units, and whole tokens converted exactly with `BigInt` (`tokenUnits.ts`). Decimals come from `tron._token`, which the `blockchain:token-metadata` job fills for active TRC-20 tokens. When decimals are unknown, which is true for unresolved TRC-20 tokens and all TRC-10 tokens today, `value` is null and a note tells the model to use `raw` and not guess.

USD values come from the `'price-history'` service's daily closes. Today has no close until the day ends, so a value uses the latest close on or before the transfer's day, within two days, and names that `priceDay`. Aggregates use the close at the window's end. Tags come from the `'address-tags'` service. Both services are optional: when one is missing or fails, the response says so in `notes` rather than failing.

### Poisoning flags

Two different counterparties of one wallet that share their first four and last four characters are the pattern address poisoning uses. The counterparties tool computes this with a window function over every grouped counterparty, not only the returned page, and adds `resemblesCounterparties` to the affected rows. The profile tool lists whole `lookalikeGroups`. Both call it a resemblance, since vanity addresses and chance matches trip it too.

### Tracing

`blockchain-trace-flow` runs one grouped query per hop over every address at that depth (`address IN {frontier}`), which the ledger's address-first sort key serves as a set of range reads. Three rules bound it:

- **Time order.** Going forward, an address's outgoing transfers count only from the moment funds first reached it along the path. Going backward, its incoming transfers count only up to when funds last left it. The bound travels with each address as a query parameter.
- **Branch caps.** Each address gives at most `branches` edges (default 5, at most 8), the largest by amount. At most 15 addresses are expanded per hop. A node that was not expanded says why.
- **No revisits.** Addresses already in the graph are excluded, so a cycle ends the path.

A hop stopped by a limit ends the trace and returns the graph so far with `stoppedReason`. Busy addresses such as exchange hot wallets are the usual cause.

## Cost Guidance

Every query filters on `address` or a time window, and reads with `FINAL` so a block written twice is not counted twice. The address tools read one wallet's rows, which is cheap except for very busy addresses. `blockchain-token-activity` is the expensive one. `tron._transfer` is sorted by address, so a token filter reads every row in the window, which is why its window is capped at 24 hours. If agents hit its limits routinely, a skip index on `token` is the fix, which would be a migration.

## Quick Reference

| File | Purpose |
|---|---|
| `registerChainQueryAiTools.ts` | Builds the tools on one shared toolkit and registers them on `'ai-tools'` with `watch()`. Called from `src/backend/index.ts` |
| `ChainQueryToolkit.ts` | Resolves `'clickhouse-accounts'`, `'address-tags'`, and `'price-history'` from the registry on each call |
| `ChainQuerySession.ts` | Per-call reads: quota key, cost, deadline, error translation |
| `chainQueryInput.ts` | Re-validates every argument: checksum-verified addresses, token filters, windows, cursors |
| `chainQueryResponse.ts` | The envelope and `runChainQueryTool` |
| `ChainCoverageReader.ts`, `TokenCatalog.ts`, `UsdPricer.ts`, `AddressTagLookup.ts`, `lookalikes.ts` | The shared enrichment |
| `tools/` | One file per tool, plus `chainQueryToolShared.ts` with `AI_TOOL_NAMES`, the capability, and shared schema pieces |

## Further Reading

- [system-chain-data-clickhouse.md](./system-chain-data-clickhouse.md) — the `tron` tables, `tron._transfer`, `tron._token`, and retention
- [system-ai-tools.md](./system-ai-tools.md) — the tool contract, including the handler's `context` argument, and the governor
- [ClickHouse Accounts README](../../src/backend/modules/clickhouse-accounts/README.md) — the `ai-agent` account's limits, quota keys, and how an admin tunes them
- [Address Tags README](../../src/backend/modules/address-tags/README.md) and [Price History README](../../src/backend/modules/price-history/README.md) — where tags and prices come from
