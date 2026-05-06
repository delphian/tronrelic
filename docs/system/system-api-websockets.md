# WebSocket Monitoring and Real-Time Events

Admin endpoints for inspecting plugin WebSocket activity, plus the catalog of core real-time events any client can subscribe to. Admin endpoints require auth — see [system-api.md](./system-api.md#authentication). Public WebSocket connections do not.

## Why This Matters

Every plugin namespaces its rooms and events under its `pluginId`, so per-plugin stats let operators identify which feature is responsible for a connection or message-rate spike. The core events (`transaction:large`, `block:new`, etc.) are the public real-time API — dashboards, alert bots, and external analytics consume them without polling.

## Admin Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/websockets/stats` | Per-plugin metrics for every registered plugin |
| GET | `/admin/system/websockets/aggregate` | Totals across all plugins plus "most active" callouts |
| GET | `/admin/system/websockets/plugin/:pluginId` | One plugin; 404 if not WebSocket-enabled |

### Per-plugin payload — `IPluginWebSocketStats`

| Field | Type | Notes |
|---|---|---|
| `pluginId` | string | |
| `pluginTitle` | string | Human-readable plugin name |
| `hasSubscriptionHandler` | boolean | Plugin registered an `onSubscribe` callback |
| `hasUnsubscribeHandler` | boolean | Plugin registered an `onUnsubscribe` callback |
| `activeRooms` | number | Count of rooms with at least one member |
| `totalSubscriptions` | number | Sum of `memberCount` across all rooms |
| `roomStats` | array | Per-room `{ roomName, memberCount, ... }` |
| `totalEventsEmitted` | number | Lifetime since process start |
| `totalSubscriptionErrors` | number | Lifetime |
| `lastEventEmittedAt` | string \| null | ISO |
| `lastSubscriptionErrorAt` | string \| null | ISO |
| `eventsPerMinute` | number | Rolling rate |

### Aggregate payload — `IAggregatePluginWebSocketStats`

| Field | Type | Notes |
|---|---|---|
| `totalPlugins` | number | Plugins with WebSocket handlers registered |
| `pluginsWithActiveSubscriptions` | number | Subset with `totalSubscriptions > 0` |
| `totalRooms` | number | Sum of `activeRooms` |
| `totalSubscriptions` | number | Sum across plugins |
| `totalEventsEmitted` | number | |
| `totalSubscriptionErrors` | number | |
| `mostActivePlugin` | `{pluginId, subscriptionCount}` \| undefined | By subscription count |
| `mostActiveEmitter` | `{pluginId, eventsPerMinute}` \| undefined | By emission rate |

### 404 from `/websockets/plugin/:pluginId`

```json
{ "success": false, "error": "Plugin <id> not found or does not have WebSocket capabilities" }
```

## Connecting

```javascript
import io from 'socket.io-client';
const socket = io('http://localhost:4000', { transports: ['websocket'] });
```

The `subscribe` handler accepts three formats (`websocket.service.ts:135-156`):

```javascript
// 1. Room-based (preferred for plugins)
socket.emit('subscribe', 'plugin-id', 'room-name', { /* options */ });

// 2. Legacy plugin format
socket.emit('subscribe', 'plugin-id', { /* options */ });

// 3. Legacy core-capabilities format (object literal, not plugin id)
socket.emit('subscribe', {
    transactions: { minAmount: 1_000_000, addresses: ['T...'] },
    comments: { resourceId: 'abc123' },
    chat: true,
    user: true        // server resolves UUID from cookie
});

// Unsubscribe (room-based)
socket.emit('unsubscribe', 'plugin-id', 'room-name');
```

Format 3 keys are core capabilities (`transactions`, `comments`, `chat`, `markets`, `memos`, `notifications`, `user`), not plugin IDs. The `user` subscription resolves the UUID server-side from the `tronrelic_uid` cookie — clients must not pass a userId.

Subscribe failures surface as `subscription:error` with `{ message }`. Standard Socket.IO `connect_error` and `disconnect` events apply; on `disconnect` reason `'io server disconnect'` the client must call `socket.connect()` to reconnect.

## Core Events

The full union is `TronRelicSocketEvent` (`src/shared/types/socket.ts:168`).

### `transaction:large`, `delegation:new`, `stake:new`

All three carry `payload: TronTransactionDocument`:

| Field | Type | Notes |
|---|---|---|
| `txId` | string | |
| `blockNumber` | number | |
| `timestamp` | string | ISO |
| `type` | TronTransactionType | One of 13 contract types incl. `Unknown` |
| `subType` | string \| undefined | |
| `from`, `to` | `AddressMetadata` | `{address, name?, type?, labels?, description?}` — **no `balance` field** |
| `amount` | number | Raw sun |
| `amountTRX` | number | Already divided by 1e6 |
| `amountUSD` | number \| undefined | |
| `energy` | `ResourceCost` \| undefined | `{consumed, price, totalCost}`. **Currently always `undefined`** because blockchain sync passes `info=null` to skip per-tx receipt fetches (see [sync architecture](./system-blockchain-sync-architecture.md#energy-cost-limitation)). |
| `bandwidth` | `ResourceCost` \| undefined | Same shape as `energy`; same caveat |
| `contract` | `{address, method?, parameters?}` \| undefined | Smart-contract calls only |
| `memo` | string \| null \| undefined | |
| `internalTransactions` | array \| undefined | |
| `analysis` | `{pattern, riskScore, confidence, relatedAddresses}` \| undefined | Pattern enum: accumulation, distribution, arbitrage, exchange flows, mega_whale, etc. |
| `notifications` | string[] \| undefined | Notification channel names triggered |

### `block:new`

```ts
payload: {
    blockNumber: number,
    timestamp: string,            // ISO
    stats: Record<string, unknown> // see below
}
```

In practice the emitter sends a `BlockStats` reduce:

| Stats field | Type |
|---|---|
| `transfers`, `contractCalls`, `delegations`, `stakes`, `tokenCreations`, `internalTransactions` | number |
| `totalEnergyUsed`, `totalEnergyCost`, `totalBandwidthUsed` | number |
| `transactions` | number — count of processed transactions in this block |

The `stats` field is typed as a generic `Record` because additional aggregations may appear over time without a type bump.

### `comments:new`

| Field | Type |
|---|---|
| `threadId`, `commentId`, `wallet`, `message` | string |
| `createdAt` | ISO string |
| `attachments` | `Array<{attachmentId, filename, contentType, size, url}>` \| undefined |

### `chat:update`

`{ messageId, wallet, message, updatedAt }` — all strings.

### `memo:new`

`{ memoId, txId, memo, timestamp, fromAddress, toAddress }` — all strings.

### `user:update`

Identity-scoped (room: `user:<uuid>`). Payload includes the user's `id`, `wallets[]` (each `{address, linkedAt, isPrimary, label?}`), `preferences` (theme, timezone, language, notifications flag), `activity` (lastSeen, pageViews, firstSeen), and timestamps.

### `menu:update`

Refetch signal — `{ event, namespace, nodeId, timestamp }`. Per-user gating means there is no single tree shape that fits every connected client, so the server emits a refetch nudge instead of the tree. Clients re-request `GET /api/menu?namespace=...` with their own credentials and receive their filtered view.

### `menu:namespace-config:update`

`{ namespace, config: Record<string, unknown>, timestamp }`.

```javascript
socket.emit('subscribe', { transactions: { minAmount: 1_000_000 } });
socket.on('transaction:large', tx =>
    console.log(`Whale: ${tx.amountTRX} TRX ($${tx.amountUSD ?? '?'}) ${tx.from.address} → ${tx.to.address}`)
);
```

## Further Reading

- [plugins/plugins-websocket-subscriptions.md](../plugins/plugins-websocket-subscriptions.md) — Building plugin subscriptions, room namespacing
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — Where transaction and block events originate; why `energy`/`bandwidth` are typically undefined
- Source: `src/shared/types/socket.ts` (event union), `src/backend/services/plugin-websocket-registry.ts` (admin stats)
