# Chain Query AI Tools

Seventeen read-only AI tools let an agent walk TronRelic's ClickHouse copy of the TRON chain. They profile a wallet, list its transfers and counterparties, follow funds across several hops, and find permission takeovers, resource delegation, and account activations. They explain one transaction in full, describe one block and whether it was stored completely, and describe token, contract, and network activity, including what contracts pay out, which contracts call each other, and which contracts were deployed. They live in `src/backend/modules/blockchain/chain-query/` and read the `tron` database described in [system-chain-data-clickhouse.md](./system-chain-data-clickhouse.md).

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
| `blockchain-permission-changes` | Permission updates, each classified by whether the account's own key still controls it, and transactions signed under a non-owner permission or by several keys | 24h / 168h (48h for signed transactions) |
| `blockchain-resource-delegations` | Energy and bandwidth delegations as events, per counterparty, or ranked across the chain, plus stake, unstake, and withdrawal series | 24h / 168h |
| `blockchain-new-accounts` | Which wallets activate new accounts, the activations themselves, or hourly counts | 24h / 72h with a funder or account, 24h without |
| `blockchain-transaction-trace` | One transaction in full: the signer's call with its function name, the internal transactions it ran, every value movement, the receipt's energy and fees, and optionally its decoded events | No window; looks across all retention |
| `blockchain-get-block` | One block by number: its header, the transaction count it reports beside the count stored, whether receipts were fetched, totals for internal transactions, energy, bandwidth, and fees, counts by contract type and status, any ingest gap records for the height, and a page of its transactions with each one's receipt summary. A height with no stored block is reported as older than retention, newer than the newest stored block, or a hole | No window; one block |
| `blockchain-find-token` | The TRC-20 contracts claiming a symbol or name, with a day of activity, and which one an operator tagged as the real token | 24h / 24h |
| `blockchain-contract-activity` | One contract's calls, callers, function selectors, failures by status, and energy and fees | 24h / 72h |
| `blockchain-contract-events` | One contract's event logs, with well-known events decoded, or its events counted by type | 24h / 168h |
| `blockchain-contract-payouts` | The value one contract sent or received, per token and source, its top counterparties, and the recipients whose first stored movement was its TRX or TRC-10 payment | 24h / 72h |
| `blockchain-contract-call-graph` | The contracts that call one contract during execution, or the addresses it calls, from its internal transactions, including calls that move no value | 24h / 72h |
| `blockchain-contract-deployments` | Contracts created in the window, by a wallet (`CreateSmartContract`) or by another contract (an internal transaction with note `create`), with their deployers | 24h / 72h |
| `blockchain-network-stats` | Chain-wide series per hour or day: blocks, transactions by type, failures, fees, energy, or value senders | 24h / 168h for blocks, 24h for value senders, 72h otherwise |

All of them declare `read` / `internal` with `surfacesUntrustedContent`, because token symbols and names are chosen by whoever deployed the contract, and memos and event data are written by third parties. The governor therefore wraps every result as data before the model sees it. `internal` rather than `public` is because results carry operator-assigned address tags.

Every tool here passes the MCP safety floor, so an admin can grant any of them to `mcp-users` on `/system/mcp`.

### No tool runs SQL the model wrote

Every query these tools run is written in this codebase, and the model's values reach ClickHouse only as query parameters. Keep it that way. On ClickHouse 24.3 the `ai-agent` account can still read most `system.*` tables, including `system.query_log`, which holds other accounts' queries, so the account's grants alone do not make model-written SQL safe. A free-form SQL tool used to exist and depended on a text filter to refuse those references. That filter could not be shown to be complete, and a review found two ways past it, so the tool was removed. When agents need a question these tools cannot answer, add a tool with a fixed query for it.

A token filter accepts `TRX`, a TRC-20 contract address, or a TRC-10 id. A symbol such as `USDT` is refused, because any contract can answer `symbol()` with `USDT` and address poisoning relies on exactly that.

## How It Works

### One session per call

`runChainQueryTool` opens a `ChainQuerySession` for each call. The session reads through `IClickHouseAccountService.reader('ai-agent')` and does three things on top of the account's limits:

- **It charges reads to the run.** The governor passes each handler an `IToolHandlerContext` (see [system-ai-tools.md](./system-ai-tools.md#the-tool-contract)), and the session sends its `queryId` as the ClickHouse quota key, so each agent run has its own hourly budget. An entry point that wants a different budget sets `quotaKey`, which the session sends in preference to `queryId`; the MCP endpoint uses this to give each user one budget of their own. When a call has neither, the session sends its `conversationId` instead, so every run in that conversation shares one hourly budget. With neither, no key is sent and the call draws on the budget the `ai-agent` account shares with every other unkeyed call.
- **It adds up the cost.** Queries, rows and bytes read, and the ClickHouse query ids go into every response's `cost`, which comes first in the object so the governor's short audit digest still contains the ids.
- **It cancels its own reads after 25 seconds.** That is under the governor's 30-second handler budget, so a slow query is cancelled on the server and reported with advice rather than left running after the governor gives up waiting.

`ChainQuerySession.translate` turns ClickHouse limit errors (`TOO_MANY_ROWS`, `TIMEOUT_EXCEEDED`, `QUOTA_EXCEEDED`, and the rest) into a message telling the model how to ask for less. Any other error is logged in full and reported without SQL or server detail, because the SQL is ours and a faulty query is a bug the model cannot fix.

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

### Receipts and coverage

Logs, internal transactions, fees, energy, and TRC-20 transfers come from receipts, so a block without receipts hides them. Delegations, staking, and permission updates come from the block itself. A tool reading only block contents passes `usesReceipts: false` to `buildChainResponse`, which then judges completeness by `coverage.blocksComplete` (every block stored) rather than `coverage.complete` (every block stored with receipts), so it does not call its totals lower bounds when nothing it counts was hidden.

### Permission takeovers

`blockchain-permission-changes` reads the new owner permission from each `AccountPermissionUpdateContract` and classifies the account as `self-controlled`, `shared-owner-control` (its own key needs co-signers), or `owner-control-transferred` (its own key was removed). The last is the pattern of the common TRON account takeover, but exchanges and multisig wallets set it up on purpose, so the description calls it a lead rather than proof. The update replaces every permission, and the previous ones are not stored, so the tool reports the new state, not a change list.

### Recognising activations

The chain data holds no account state, so `blockchain-new-accounts` recognises an activation from what the activating transaction recorded. An `AccountCreateContract` is one by definition. A TRX or TRC-10 transfer to an address that did not exist pays the account-creation fee on top of its bandwidth and energy fees. The tool subtracts those, then the memo fee if the transaction carries a memo and the multi-signature fee if it carries more than one signature, and counts the transfer as an activation when the creation fee remains. This was checked against mainnet block 86,723,912.

The three fees are chain parameters set by governance, each 1 TRX today, and live in `ACTIVATION_FEES_SUN` because the chain parameters service does not track them. If a proposal changes one, that constant must change with it. Accounts created inside smart contract calls pay in energy rather than a separate fee and are not detected.

### Symbols and verified tokens

Every tool refuses a symbol as a token filter. `blockchain-find-token` is the way from a symbol to an address. It lists every contract in `tron._token` claiming the symbol or name, plus any contract tagged for it, and marks `verified: true` only on a contract an operator tagged `token:<symbol>` on `/system/address-tags`, such as `token:usdt` on `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. A candidate found by name, such as `Tether USD`, is also verified when it carries the token tag for the symbol it reports, since nobody tags `token:tether usd`. The tag still has to sit on that contract's own address, so an imitation reporting the same symbol gains nothing. The mark comes from a person because the chain cannot supply it: an imitation contract reports the same symbol and name as the real one.

Write the tag in lower case. Tags are stored exactly as typed, so the tool looks up the lower-case and upper-case forms, but a mixed-case tag such as `token:Usdt` is not found. Tag a contract only on the issuer's own confirmation of the address. USDD, for example, has a retired 2022 contract that still answers `USDD`, and its issuer names `TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz` as the current one. When two contracts carry the same token tag, the tool reports both and tells the model not to choose. `blockchain-contract-activity` also reports a contract's token tag when it has one.

## Cost Guidance

Every query filters on `address` or a time window, and removes the duplicates a block written twice leaves behind. Most do it with `FINAL`. Two kinds of read cannot, because ClickHouse 24.3 turns off two optimizations in a `FINAL` read. Skip indexes are ignored unless `use_skip_indexes_if_final` is set, so a `tx_id` lookup with `FINAL` reads all seven days. And ClickHouse does not move a filter into PREWHERE on its own (`optimize_move_to_prewhere_if_final` is off). PREWHERE reads one column first and the rest of a row only where it matches, so without it a scan for rare rows such as deployments reads every wide column. Later releases turn that setting on, but even then they move only conditions on the sort key, and neither `contract_type` nor `note` is one. `blockchain-transaction-trace`, `blockchain-contract-deployments`, and `blockchain-contract-call-graph` therefore read without `FINAL` and remove duplicates with `LIMIT 1 BY` on each row's identity. The `first-seen` view of `blockchain-contract-payouts` also reads without `FINAL`, because a minimum and the row it comes from do not change when a row is duplicated.

`blockchain-transaction-trace` costs about the same whatever the transaction. It finds the transaction through the `tx_id` skip index and reads the receipt and internal transactions by block number, which leads their sort key. Its optional event logs are the expensive part: `tron.log` is sorted by emitting contract, so finding one transaction's logs reads the time column for that whole day. `blockchain-get-block` is cheap for any height, because `tron.block`, `tron.transaction`, `tron.transaction_info`, and `tron.internal_transaction` all lead their sort key with the block number, and naming the block's time opens only its day. It reads with `LIMIT 1 BY` rather than `FINAL` for the same reason the trace does, and it leaves event logs out entirely, because counting one block's logs would scan that whole day of `tron.log`. `blockchain-contract-payouts` is a range read on `tron._transfer`'s address-first sort key, cheap for most contracts and slower for a DEX router. Its `first-seen` view adds one range read per recipient, which is why it needs a short window for contracts paying many addresses. `blockchain-contract-deployments` scans the window's `tron.transaction` and `tron.internal_transaction` rows, limited by `blockRangeCondition()` and filtered with PREWHERE on `contract_type` and on the internal transaction's `note`. `blockchain-contract-call-graph` is a plain scan of `tron.internal_transaction` with PREWHERE on whichever address column the view matches. That table holds about 380 MB for the whole retention, so the scan stays cheap without a second copy sorted by address. If the scan's `cost` ever grows too large, add that copy, filled by a materialized view, rather than shortening the window.

The address tools read one wallet's rows, which is cheap except for very busy addresses. `blockchain-token-activity` is the expensive one. `tron._transfer` is sorted by address, so a token filter reads every row in the window, which is why its window is capped at 24 hours. If agents hit its limits routinely, a skip index on `token` is the fix, which would be a migration. The other caps follow the same rule: a tool's window is set by the table it reads without a sort-key filter. `blockchain-contract-events` and `blockchain-find-token` filter `tron.log` by contract and event signature, which lead its sort key, so they are range reads. `blockchain-contract-activity` reads every call and receipt in the window and keeps one contract's, so it stops at 72 hours. `blockchain-network-stats` and the permission-signed view of `blockchain-permission-changes` read `tron.transaction` or `tron.transaction_info` whole. The delegation, staking, and permission update tables are small enough for the full retention.

`blockchain-new-accounts` without a funder or account reads both `tron.transaction` and `tron.transaction_info` whole, about 10 million rows each per mainnet day, plus the transfer tables, so it stops at 24 hours to stay under the account's 50-million-row limit. Three rules keep it there, and a change to its query should keep all three. Each of those two tables is read once, and the TRX and TRC-10 transfers are combined before the single join to it. The signature count comes from `signature.size0`, because `length(signature)` read the full signatures and made them most of the bytes read. And both tables are also bounded by `blockRangeCondition()`, a block-number range taken from `tron.block`, because their sort key leads with `block_number` and a time condition alone skips only whole days. With a funder or account, those two reads are further limited to that party's transfers, which is why that form allows 72 hours.

That party form reads the transfer tables three times, once for the join and once for each of the two lists that narrow the transaction and receipt reads. ClickHouse 24.3 does not share one list between subqueries, so each is read separately. The reads therefore skip `FINAL` and remove duplicates with `LIMIT 1 BY tx_id`, which lets an `account` lookup use the `to_address` skip index. With `FINAL`, each read covered every TRX and TRC-10 transfer in the window, about 6 million rows a day, and three of them passed the row limit at 72 hours. The chain-wide form reads the transfer tables once and keeps `FINAL`, because `LIMIT 1 BY` over a whole day's transaction ids would use far more memory.

## Quick Reference

| File | Purpose |
|---|---|
| `registerChainQueryAiTools.ts` | Builds the tools on one shared toolkit and registers them on `'ai-tools'` with `watch()`. Called from `src/backend/index.ts` |
| `ChainQueryToolkit.ts` | Resolves `'clickhouse-accounts'`, `'address-tags'`, and `'price-history'` from the registry on each call |
| `ChainQuerySession.ts` | Per-call reads: quota key, cost, deadline, error translation |
| `chainQueryInput.ts` | Re-validates every argument: checksum-verified addresses, token filters, windows, cursors |
| `chainQueryResponse.ts` | The envelope and `runChainQueryTool` |
| `ChainCoverageReader.ts`, `TokenCatalog.ts`, `UsdPricer.ts`, `AddressTagLookup.ts`, `lookalikes.ts` | The shared enrichment |
| `chainSignatures.ts` | Names for well-known method selectors and event signatures, and decoding of standard token and Tether events. The tests recompute every hash |
| `tools/` | One file per tool, plus `chainQueryToolShared.ts` with `AI_TOOL_NAMES`, the capability, and shared schema, window, and cursor pieces |

## Further Reading

- [system-chain-data-clickhouse.md](./system-chain-data-clickhouse.md) — the `tron` tables, `tron._transfer`, `tron._token`, and retention
- [system-ai-tools.md](./system-ai-tools.md) — the tool contract, including the handler's `context` argument, and the governor
- [ClickHouse Accounts README](../../src/backend/modules/clickhouse-accounts/README.md) — the `ai-agent` account's limits, quota keys, and how an admin tunes them
- [Address Tags README](../../src/backend/modules/address-tags/README.md) and [Price History README](../../src/backend/modules/price-history/README.md) — where tags and prices come from
