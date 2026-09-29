# WebSocket Monitoring and Real-Time Events

Admin endpoints for inspecting plugin WebSocket activity, plus the catalog of core real-time events any client can subscribe to. Admin endpoints require auth — see [system-api.md](./system-api.md#authentication). Public WebSocket connections do not.

## Why This Matters

Every plugin namespaces its rooms and events under its `pluginId`, so per-plugin stats let operators identify which feature is responsible for a connection or message-rate spike. The core events (`block:new`, `memo:new`, etc.) are the public real-time API — dashboards, alert bots, and external analytics consume them without polling.

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

The `subscribe` handler in `WebSocketService` accepts three formats:

```javascript
// 1. Room-based (preferred for plugins)
socket.emit('subscribe', 'plugin-id', 'room-name', { /* options */ });

// 2. Legacy plugin format
socket.emit('subscribe', 'plugin-id', { /* options */ });

// 3. Legacy object format
socket.emit('subscribe', {
    memos: { all: true },                // joins memos:all
    'plugin-id': { /* options */ }      // same as format 2
});

// Unsubscribe (room-based)
socket.emit('unsubscribe', 'plugin-id', 'room-name');
```

In format 3, `memos` is the only core key still honoured, because the alert service emits `memo:new` to `memos:all`; every other key is matched only against registered plugin ids. The older core keys `transactions`, `comments`, `chat`, `markets`, and `notifications` were removed: nothing on the server sent to their rooms, and `notifications:<wallet>` accepted any wallet, so the first emit to it would have reached anyone who asked.

A plugin subscription failure surfaces as `<plugin-id>:subscription-error` with `{ error, pluginId, roomName }`. `error` is `'Subscription rejected'` unless the plugin threw an error marked `expose: true`; see [plugins-websocket-subscriptions.md](../plugins/plugins-websocket-subscriptions.md#subscription-handlers). Standard Socket.IO `connect_error` and `disconnect` events apply; on `disconnect` reason `'io server disconnect'` the client must call `socket.connect()` to reconnect. The server disconnects a signed-in user's sockets itself when their session is deleted or their groups change, so that they reconnect with current identity rooms (see [Keeping identity rooms current](#keeping-identity-rooms-current)).

### Limits

Every client message is untrusted. Before any handler runs, core checks it against the limits below and drops what falls outside them, logging at `debug` so a flood cannot push real errors out of the capped system log. A malformed message is ignored; it never throws, and a rejected promise anywhere in the process is logged rather than allowed to stop it.

| Limit | Value |
|-------|-------|
| Plugin id and room name | 1–64 characters from `A–Z a–z 0–9 : _ . -` |
| Client-requested rooms per socket | 50 (plugin rooms and `memos:all`; identity rooms and the socket's own room do not count) |
| Subscribe plus unsubscribe events per socket | 30 per 10 seconds |
| Largest message (`maxHttpBufferSize`) | 16 KB |

The constants live at the top of `src/backend/services/websocket.service.ts`.

## Core Events

The full union is `TronRelicSocketEvent` exported from `src/shared/types/socket.ts`.

`transaction:large`, `delegation:new`, `stake:new`, `comments:new`, and `chat:update` remain in the `TronRelicSocketEvent` union but are not delivered: nothing on the server emitted them, and their routing was removed with the legacy subscriptions. An emit of one is dropped like any unrecognised event.

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

### `memo:new`

`{ memoId, txId, memo, timestamp, fromAddress, toAddress }` — all strings.

### `menu:update`

Refetch signal — `{ event, namespace, nodeId, timestamp }`. Per-user gating means there is no single tree shape that fits every connected client, so the server emits a refetch nudge instead of the tree. Clients re-request `GET /api/menu?namespace=...` with their own credentials and receive their filtered view.

### `menu:namespace-config:update`

`{ namespace, config: Record<string, unknown>, timestamp }`.

## Event Audience

`WebSocketService.emit` picks each event's audience by name, and the choice is part of the event's contract rather than an implementation detail — an over-broad emit still reaches the intended surface, so the mistake shows up in neither review nor manual testing. `src/backend/services/__tests__/websocket-routing.test.ts` pins the decision for every case.

| Audience | Events | Why |
|---|---|---|
| Subscribed rooms | `memo:new` | Clients opt in through `subscribe`; the room is the filter |
| `group:admin` | `ai-tools:activity`, `ai-tools:approvals-changed`, `curation:changed`, `price-history:stats`, `content:published` | Refetch nudges whose only subscribers live under `/system/*`, plus `content:published`, whose sink declares an admin audience. Payloads are timestamp-or-count only except `content:published` (`{id, title, publishedAt}`), which a global emit leaked to anonymous visitors |
| `user:${id}` rooms | `notification` | Resolved per-recipient by the notifications dispatch pipeline |
| Every socket | `block:new`, `menu:update`, `menu:namespace-config:update`, `widgets:placements-update`, `account-history:stats`, `toast` | Genuinely public, or consumed by a non-admin surface. `account-history:stats` is the one to watch: besides the admin dashboard it drives `WalletManager` on a signed-in user's own profile, and identity rooms address one user or one group, so there is no "every authenticated socket" room to narrow it to |

### Keeping identity rooms current

Room-scoped delivery makes handshake-time identity load-bearing, and its failure mode is quiet: a socket outside `group:admin` still connects and renders, it just stops receiving updates. Three mechanisms keep that from happening silently.

`joinIdentityRooms` populates `user:${id}` and one `group:${id}` per group from the session resolved during the handshake. `SocketBridge` re-handshakes (disconnect + connect) whenever the client-visible identity changes — **user id or group membership**, so both signing in and being promoted to `admin` mid-session rejoin without a page reload. And because a Socket.IO handshake captures its cookie once and never refreshes it, a session resolution that *throws* is retried once server-side before the socket is allowed to connect anonymous; an anonymous visitor resolves to `null` without throwing, so ordinary public traffic is never retried.

One residual: if resolution fails twice, the socket connects with no identity rooms and stays that way until it reconnects. That path logs at `error` naming the consequence, which is the thread to pull on a report of "the dashboard stopped updating."

The opposite failure — a socket keeping rooms its user has lost — is closed server-side, because a hostile client need not re-handshake when told to. `WebSocketService.disconnectUser(userId, sessionId?)` drops a user's sockets, and the identity module calls it in two places: after Better Auth deletes a session (sign-out or revocation), for the sockets opened with that session only, and after any group membership write, for all of the user's sockets. The official client reconnects immediately and rejoins with its current identity.

Adding an event means adding a `case` and choosing its audience deliberately. There is no catch-all `emit`: an unrecognised event is logged and dropped, so a new event is inert until someone picks its audience — silent is the correct failure direction, broadcast-to-everyone is not.

```javascript
socket.emit('subscribe', { memos: { all: true } });
socket.on('memo:new', memo => console.log(`${memo.fromAddress} → ${memo.toAddress}: ${memo.memo}`));
```

## Further Reading

- [plugins/plugins-websocket-subscriptions.md](../plugins/plugins-websocket-subscriptions.md) — Building plugin subscriptions, room namespacing
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — Where transaction and block events originate; why `energy`/`bandwidth` are typically undefined
- Source: `src/shared/types/socket.ts` (event union), `src/backend/services/plugin-websocket-registry.ts` (admin stats)
