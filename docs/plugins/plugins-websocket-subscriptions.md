# Plugin WebSocket Subscription Management

Plugins manage custom real-time subscriptions through a per-plugin manager that auto-prefixes room and event names, validates subscription payloads, and exposes per-plugin statistics — without modifying core WebSocket infrastructure.

## Why This Matters

Socket.IO has a single global event namespace. Two plugins both emitting `'update'` would collide; clients would receive events from plugins they never asked for. The plugin WebSocket manager prefixes every room and event with the plugin id, so plugin code reads cleanly (`emit('update', payload)`) while the wire protocol stays collision-safe and per-plugin metrics stay attributable.

## Auto-Prefixing Rules

Plugin code uses unprefixed names everywhere. The manager rewrites them at the boundary:

| Surface | Plugin writes | Wire value |
|---------|---------------|------------|
| Room | `large-transfer` | `plugin:<plugin-id>:large-transfer` |
| Event (emit) | `update` | `<plugin-id>:update` |
| Event (listen, frontend) | `update` | `<plugin-id>:update` |

Touch raw names only when calling `getRawIO()` for cross-plugin or system-wide broadcasts.

## How It Works

1. Plugin registers handlers in `init()` via `context.websocket.onSubscribe()` / `onUnsubscribe()`.
2. Client calls `websocket.subscribe('room-name', payload?)`.
3. WebSocketService routes by plugin id and room name.
4. Client is **auto-joined** to `plugin:<plugin-id>:room-name` *before* the subscribe handler runs.
5. Subscribe handler validates and processes the payload (or throws to reject).
6. Plugin emits via `emitToRoom(roomName, eventName, payload)` when relevant data arrives.
7. Clients receive `<plugin-id>:eventName` and update UI.

## Subscription Handlers

Both handlers receive `(socket, roomName, payload)`. The room name is unprefixed. The client has already been auto-joined (subscribe) or auto-left (unsubscribe) before the handler runs — so handlers exist for validation, side-effects, and per-socket state, not membership management.

```typescript
context.websocket.onSubscribe(async (socket, roomName, payload) => {
    const { minAmount = 500_000 } = payload || {};

    if (minAmount < 0 || minAmount > 100_000_000) {
        throw new Error('Invalid minAmount threshold');
    }

    // Per-socket state (e.g., for filtering inside emitToRoom)
    socket.data.filters = { minAmount };

    // Confirmation event auto-prefixed as '<plugin-id>:subscribed'
    context.websocket.emitToSocket(socket, 'subscribed', { roomName, minAmount });
});

context.websocket.onUnsubscribe(async (socket, roomName, payload) => {
    delete socket.data.filters;
    context.logger.debug({ socketId: socket.id, roomName }, 'Client unsubscribed');
});
```

Behavior to know: throwing inside `onSubscribe` rejects the subscription and emits a plugin-prefixed error event to the client. Throws inside `onUnsubscribe` are logged but don't prevent unsubscribe completion — clients sometimes disconnect without ever sending `unsubscribe`, so cleanup is best-effort.

## Manual Room Management (Rare)

Auto-join/auto-leave handle the common case. Reach for these only when registering a single socket into multiple rooms based on payload, or when implementing custom membership rules:

```typescript
context.websocket.joinRoom(socket, 'high-value-transfers');     // → plugin:<id>:high-value-transfers
context.websocket.leaveRoom(socket, 'high-value-transfers');
const members = await context.websocket.getSocketsInRoom('high-value-transfers');
```

Empty rooms are cleaned up by Socket.IO automatically.

## Event Emission

```typescript
// Broadcast to all clients in a room
context.websocket.emitToRoom('large-transfer', 'large-transfer', {
    txId, amountTRX
});
// Wire room:  plugin:<plugin-id>:large-transfer
// Wire event: <plugin-id>:large-transfer

// Send to one socket (e.g., subscribe confirmation)
context.websocket.emitToSocket(socket, 'subscribed', { roomName, status: 'subscribed' });
```

Both room and event names are auto-prefixed. Payloads must be JSON-serializable. Emits are fire-and-forget — no delivery confirmation.

## Raw Socket.IO Escape Hatch

```typescript
const io = context.websocket.getRawIO();
io.emit('system:maintenance', { message: 'Restart in 5 minutes' });   // bypasses rooms
const sockets = await io.fetchSockets();
```

Only use for genuinely global operations. Anything plugin-scoped should go through the namespaced helpers.

## Frontend Usage

```typescript
function MyPluginComponent({ context }: { context: IFrontendPluginContext }) {
    useEffect(() => {
        const { websocket } = context;
        const payload = { minAmount: 500_000 };

        const subscribe = () => websocket.subscribe('large-transfer', payload);

        const handleTransfer = (tx: any) => { /* update state */ };
        const handleConfirmed = (data: any) => { /* show subscribed status */ };
        const handleError = (err: any) => { /* surface error */ };

        websocket.on('large-transfer', handleTransfer);
        websocket.on('subscribed', handleConfirmed);
        websocket.on('subscription-error', handleError);
        websocket.onConnect(subscribe);

        subscribe();  // capture the first handshake — Socket.IO buffers if not yet connected

        return () => {
            websocket.unsubscribe('large-transfer', payload);
            websocket.off('large-transfer', handleTransfer);
            websocket.off('subscribed', handleConfirmed);
            websocket.off('subscription-error', handleError);
            websocket.offConnect(subscribe);
        };
    }, [context.websocket]);

    return null;
}
```

Subscribe immediately *and* on connect — the first handshake may have already fired, and re-subscribing on reconnect is necessary because Socket.IO doesn't remember rooms across reconnects. Always pair `subscribe(roomName, payload)` with `unsubscribe(roomName, payload)` using the matching payload so the backend can release server-side state.

The `IWebSocketClient` shape (frontend) is documented in [plugins-frontend-context-websocket.md](./plugins-frontend-context-websocket.md).

## Monitoring

Admin-gated endpoints expose per-plugin statistics:

| Endpoint | Returns |
|----------|---------|
| `GET /api/system/websockets/stats` | All plugin statistics |
| `GET /api/system/websockets/aggregate` | System-wide aggregates |
| `GET /api/system/websockets/plugin/:pluginId` | Specific plugin stats |

Admin UI at `/system/websockets` shows plugin counts, active subscriptions, events emitted since startup, per-plugin room breakdowns, emission rates, and subscription error counts.

Backend logs include structured plugin metadata:

```json
{ "pluginId": "trp-whale-alerts", "socketId": "abc123", "minAmount": 500000, "roomName": "whale-500000", "msg": "Client subscribed" }
```

Filter by `pluginId` or `socketId` to debug specific issues.

## Best Practices

Validate every payload — throw descriptive errors for invalid thresholds, missing fields, or type mismatches. Use semantic room names (`whale-500000`, `delegation-energy`, `stake-freeze`) over numbered slots. A single observation can `emitToRoom` to multiple threshold rooms (500k, 1M, 2M) when it qualifies for each. Send a `subscribed` confirmation event so the client UI knows the room is live. Always pair frontend `subscribe` with `unsubscribe` in cleanup. Clean up timers and intervals in the plugin's `disable()` hook.

## Common Patterns

### Dynamic Threshold Rooms

```typescript
context.websocket.onSubscribe(async (socket, roomName, payload) => {
    const { minAmount = 500_000 } = payload || {};
    // Round to nearest 100k for room consolidation
    const rounded = Math.round(minAmount / 100_000) * 100_000;
    context.websocket.joinRoom(socket, `whale-${rounded}`);
});
```

### Multi-Room Subscriptions

```typescript
context.websocket.onSubscribe(async (socket, roomName, payload) => {
    const { tokens = [] } = payload || {};
    for (const token of tokens) {
        context.websocket.joinRoom(socket, `token-${token}`);
    }
});
```

## Troubleshooting

**Subscription not working.** Check backend logs for handler errors; verify the plugin id matches between frontend and backend; confirm payload shape matches handler expectations.

**Events not received.** Frontend listeners use unprefixed names (`websocket.on('large-transfer', h)`) — the manager adds the `<plugin-id>:` prefix at the boundary. Verify membership with `getSocketsInRoom()`. Confirm the observer actually emits.

**Memory leaks.** Ensure every event listener registered on mount has an `off` in cleanup; pair every `subscribe` with `unsubscribe`; watch the room count in the admin UI for unbounded growth on remount.

**High error counts.** Review subscription handler validation; log full payloads when investigating; cover null/undefined/type-mismatch cases in tests.

## Further Reading

- [plugins-frontend-context-websocket.md](./plugins-frontend-context-websocket.md) — `IWebSocketClient` (frontend) interface and reliable-subscription pattern
- [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) — observer-driven `emitToRoom` flow
- [plugins-system-architecture.md](./plugins-system-architecture.md) — plugin runtime and `IPluginContext`
- Reference: `src/plugins/trp-whale-alerts/` — multi-threshold room registration
