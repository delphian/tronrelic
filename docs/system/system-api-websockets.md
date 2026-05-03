# WebSocket Monitoring and Real-Time Events

Admin endpoints for inspecting plugin WebSocket activity, plus the catalog of core real-time events any client can subscribe to. Admin endpoints require auth — see [system-api.md](./system-api.md#authentication). Public WebSocket connections do not.

## Why This Matters

Every plugin namespaces its rooms and events under its `pluginId`, so per-plugin stats let operators identify which feature is responsible for a connection or message-rate spike. The core events (`transaction:large`, `block:new`, etc.) are the public real-time API — dashboards, alert bots, and external analytics consume them without polling.

## Admin Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/websockets/stats` | Per-plugin metrics |
| GET | `/admin/system/websockets/aggregate` | Totals across all plugins |
| GET | `/admin/system/websockets/plugin/:pluginId` | One plugin; 404 if not WebSocket-enabled |

### Per-plugin payload

| Field | Type | Notes |
|---|---|---|
| `pluginId` | string | |
| `activeConnections` | number | Currently connected sockets |
| `totalMessagesSent` | number | Lifetime since process start |
| `errorCount` | number | |
| `lastActivity` | string (ISO) | |

Aggregate adds `totalPlugins`, `totalConnections`, `totalMessagesSent`, `totalErrors`.

404 from `/websockets/plugin/:pluginId`:

```json
{ "success": false, "error": "Plugin <id> not found or does not have WebSocket capabilities" }
```

## Connecting

```javascript
import io from 'socket.io-client';
const socket = io('http://localhost:4000', { transports: ['websocket'] });
```

Three subscription shapes are accepted:

```javascript
// 1. Room-based (preferred for plugins)
socket.emit('subscribe', 'plugin-id', 'room-name', { /* options */ });

// 2. Legacy plugin object form
socket.emit('subscribe', 'plugin-id', { /* options */ });

// 3. Legacy core form
socket.emit('subscribe', {
    transactions: { minAmount: 1000000 },
    comments: { resourceId: 'abc123' },
    chat: true
});

// Unsubscribe (room-based)
socket.emit('unsubscribe', 'plugin-id', 'room-name');
```

Subscribe failures surface as `subscription:error` with `{ message }`. Standard Socket.IO `connect_error` and `disconnect` events apply; on `disconnect` reason `'io server disconnect'` the client must call `socket.connect()` to retry.

## Core Events

| Event | Rooms | Payload summary |
|---|---|---|
| `transaction:large` | `transactions:all`, `transactions:address:{addr}` | `{ txId, blockNumber, timestamp, type, from, to, amountTRX, amountUSD, energyUsed, energyCostUSD }` |
| `delegation:new` | Same as `transaction:large` | Same shape as `transaction:large` |
| `stake:new` | Same as `transaction:large` | Same shape as `transaction:large` |
| `block:new` | Global broadcast | `{ blockNumber, timestamp, stats: { transactionCount, totalVolumeTRX } }` |
| `comments:new` | `comments:{threadId}` | `{ threadId, commentId, wallet, message, createdAt }` |
| `chat:update` | `chat:global` | `{ messageId, wallet, message, updatedAt }` |

`transaction:large` `from`/`to` are `{ address, balance }` objects; `balance` is post-transaction in sun. `amountTRX` is human-readable TRX (already divided by 1e6).

```javascript
socket.emit('subscribe', { transactions: { minAmount: 1_000_000 } });
socket.on('transaction:large', tx =>
    console.log(`Whale: ${tx.amountTRX} TRX ($${tx.amountUSD})`)
);
```

## Related

- [plugins/plugins-websocket-subscriptions.md](../plugins/plugins-websocket-subscriptions.md) — Building plugin subscriptions, room namespacing
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — Where these events originate
