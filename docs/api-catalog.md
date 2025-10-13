# TronRelic API Catalog (Draft)

> This document bootstraps Appendix A from `SPEC.md`. Each section lists route contracts, validation notes, caching strategy, and downstream dependencies. Update and expand before implementation moves beyond the scaffold.

## Conventions

- **Auth** – `wallet` indicates TronLink signature auth, `admin` indicates private key/API key headers, `public` requires no auth.
- **Cache** – `redis:<key>` denotes the primary cache key; TTLs are in seconds.
- **Dependencies** – Primary Mongo collections or external services touched by the endpoint.

---

## Markets Domain

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/markets` | GET | public | List active markets ordered by priority with pricing metadata. | `redis:markets:current` (300s) | Mongo `markets` | Falls back to aggregator refresh if cache missing. |
| `/api/markets/refresh` | POST | admin (TBD) | Forces market crawl + cache invalidation. | None | Redis, Mongo `markets` | Rate-limited; scheduler triggers every 5 minutes. |

## Blockchain Domain

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/blockchain/transactions/latest` | GET | public | Latest transactions (limit ≤ 200) for dashboards. | None (future: redis hot set) | Mongo `transactions` | Accepts `limit` query param. |
| `/api/blockchain/sync` | POST | admin | Enqueue sync for next block window. | None | BullMQ `block-sync`, TronGrid | Used by scheduler + admin triggers. |

## Accounts Domain

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/accounts/snapshot` | GET | public | Aggregated address summary + recent transactions. | `redis:account:snapshot:{address}` (60s) | Mongo `transactions` | Validates base58 address length/prefix. |

## Transactions Analytics

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/transactions/high-amounts` | POST | public | Whale transactions above threshold. | Future: `redis:transactions:high:{threshold}` | Mongo `transactions` | Body: `{ minAmountTRX, limit }`. |
| `/api/transactions/account` | POST | public | Paginated account transaction list. | None | Mongo `transactions` | Body: `{ address, skip, limit }`. |
| `/api/transactions/ids` | POST | public | Batch lookup by TXIDs. | None | Mongo `transactions` | Body: `{ txIds[] }`. |
| `/api/transactions/latest-by-type` | POST | public | Recent transactions filtered by type. | None | Mongo `transactions` | Body: `{ type, limit }`. |

## Comments Domain

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/comments` | GET | public | Recent thread comments (reverse chronological). | `redis:comments:{threadId}` (30s) | Mongo `comments` | Query: `threadId`. |
| `/api/comments` | POST | wallet | Submit signed comment to a thread. | Invalidates comment cache tag | Mongo `comments`, Redis | Body: `{ threadId, wallet, message, signature }`. Rate-limited (3/min/IP). |

## Chat Domain

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/chat` | GET | public | Returns latest chat messages (≤500). | `redis:chat:messages` (10s) | Mongo `chat_messages` | Initial hydration for UI. |
| `/api/chat` | POST | wallet | Upsert chat message for wallet signature. | Invalidates `chat` tag | Mongo `chat_messages`, Redis | One active message per wallet enforced. |

## Notifications Domain

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/notifications/preferences` | POST | wallet | Save notification channels and thresholds. | None | Mongo `notification_subscriptions` | Body: `{ wallet, channels[], thresholds{} }`. |

## Tools & Utilities

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/tools/energy/estimate` | POST | public | Deterministic energy calculator w/ transparency output. | None | In-memory | Body: `{ contractType, averageMethodCalls, expectedTransactionsPerDay }`. |
| `/api/tools/signature/verify` | POST | public | Wallet signature verification helper. | None | TronWeb | Mirrors existing worker utility. |

## Telegram Integrations

| Route | Method | Auth | Description | Cache | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/telegram/bot/webhook` | POST | Telegram | Webhook endpoint for bot updates. | None | Mongo `telegram_users`, Telegram API | Validate IP ranges + secret token (TODO). |

---

## WebSocket Events

| Event | Payload | Rooms | Producer | Notes |
| --- | --- | --- | --- | --- |
| `market:update` | `MarketDocument` | `markets:all`, `markets:{guid}` | MarketAggregator | Emitted per market on refresh. |
| `transaction:large` | `TronTransactionDocument` | `transactions:all`, `transactions:large:{threshold}`, `transactions:address:{wallet}` | BlockchainService, analytics jobs | Threshold derived from subscription payload. |
| `delegation:new` | `TronTransactionDocument` | same as above | TODO (delegation pipeline) | Placeholder for future event. |
| `stake:new` | `TronTransactionDocument` | same as above | TODO | |
| `block:new` | `{ blockNumber, timestamp, stats }` | Global | BlockchainService | Broadcast after block processing. |
| `comments:new` | `{ threadId, commentId, wallet, message, createdAt }` | `comments:{threadId}` | CommentService | Fired after comment creation + cache invalidation. |
| `chat:update` | `{ messageId, wallet, message, updatedAt }` | `chat:global` | ChatService | Handles inserts + edits. |

---

## Outstanding Items

- Document auth headers/tokens for admin and Telegram flows.
- Define rate limit ceilings per endpoint (align with worker config).
- Capture error schemas for all routes.
- Link to ETL/migration scripts once authored (Phase 2).
- Expand to include planned gRPC/Webhook contracts if introduced.
