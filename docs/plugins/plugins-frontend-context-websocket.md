# Plugin Frontend Context — WebSocket

`context.websocket` exposes the shared Socket.IO connection with helpers that auto-prefix events and rooms by plugin ID.

## Why Auto-Prefix

A plugin emitting `update` would collide with every other plugin doing the same. The helpers wrap raw socket calls with `<pluginId>:` so plugin authors write descriptive names (`update`, `large-transfer`) and the wire protocol stays collision-free. Backend rooms are prefixed `plugin:<pluginId>:<room>`.

Use the helpers. Touch `context.websocket.socket` only when a third-party API demands a raw `Socket`.

## Interface

```typescript
interface IWebSocketClient {
    socket: Socket;                                    // raw access
    isConnected(): boolean;
    on(event: string, handler: Fn): void;              // auto-prefixed
    off(event: string, handler: Fn): void;
    once(event: string, handler: Fn): void;
    subscribe(roomName: string, payload?: any): void;  // joins plugin:<id>:<room>
    onConnect(handler: Fn): void;                      // fires on (re)connect
    offConnect(handler: Fn): void;
}
```

| Helper | Wire effect |
|--------|-------------|
| `on('update', h)` | listens for `<pluginId>:update` |
| `subscribe('high-value', payload)` | joins `plugin:<pluginId>:high-value` with payload |
| `socket.on('<id>:update', h)` | raw — manual prefix required |

## Reliable Subscription Pattern

React Strict Mode double-mounts in dev, and Socket.IO buffers emits before transport upgrade. A naive subscription that checks `socket.connected` first can be lost in that window. Always:

1. Emit immediately — Socket.IO buffers until transport is live.
2. Re-emit on `connect` — restores room membership after reconnect.
3. Clean up both event listener and `connect` handler.

```typescript
useEffect(() => {
    const { websocket } = context;

    const handler = (payload: any) => { /* update state */ };

    const subscribe = () => {
        websocket.subscribe('large-transfer', { minAmount: 500_000 });
    };

    websocket.on('large-transfer', handler);
    websocket.onConnect(subscribe);
    subscribe();  // capture the first handshake

    return () => {
        websocket.off('large-transfer', handler);
        websocket.offConnect(subscribe);
    };
}, [context.websocket]);
```

## Multiple Rooms

```typescript
websocket.subscribe('large-transfer');
websocket.subscribe('medium-value', { minAmount: 100_000 });
```

Each room is independent on the backend. Backend room registration and validation is covered in [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md).

## Connection Status

```typescript
if (!context.websocket.isConnected()) {
    // queue UX, fall back, or show indicator
}
```

## Common Mistakes

- `websocket.on('my-plugin:update', h)` — double-prefixes to `my-plugin:my-plugin:update`. Use `on('update', h)`.
- `socket.on('update', h)` — no prefix; collides across plugins. Use the helper or include the prefix manually.
- Subscribing only inside a `connect` handler — first handshake may already have fired. Subscribe immediately *and* on connect.
- Forgetting `offConnect` cleanup — duplicate subscriptions after remount.

## Further Reading

- [plugins-frontend-context.md](./plugins-frontend-context.md) — index
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) — backend room registration, subscription handlers, validation
- [react.md](../frontend/react/react.md) — useEffect dependency rules
