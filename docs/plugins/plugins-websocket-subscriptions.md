# Plugin WebSocket Subscription Management

TronRelic's plugin WebSocket system enables plugins to manage custom real-time subscriptions without modifying core WebSocket infrastructure. Each plugin controls its own subscription logic, room membership, and event emission through a namespaced manager that prevents collisions while maintaining the illusion of direct Socket.IO access.

## Understanding Plugin WebSocket Isolation (Plain English)

Think of the WebSocket system like an office building with many tenants. Without proper organization, everyone would be shouting in the hallways and nobody would know who's talking to whom.

**The Problem:** Socket.IO has a single global namespace for all events. If two plugins both emit an event called `'update'`, clients listening for updates wouldn't know which plugin sent which message. Even worse, clients could accidentally receive events from plugins they're not subscribed to.

**The Solution:** We automatically prefix everything with the plugin ID:

- **Room names**: `'large-transfer'` becomes `'plugin:whale-alerts:large-transfer'`
- **Event names**: `'large-transfer'` becomes `'whale-alerts:large-transfer'`
- **Plugin code stays clean**: You write `'large-transfer'`, the system adds the prefix

This means:
1. Each plugin has its own "office" (namespaced rooms)
2. Each plugin's messages are clearly labeled (prefixed event names)
3. Clients only receive events from plugins they're subscribed to
4. No plugin can accidentally interfere with another plugin's communication

**As a plugin author, you never see these prefixes.** You write simple code like `emitToRoom('alerts', 'new-whale', data)` and the system handles all the namespacing behind the scenes. Your code stays readable, and the system stays safe.

## Why Plugin-Managed WebSockets Exist

- **Subscription autonomy** - Plugins define custom subscription patterns matching their feature needs instead of relying on centralized hardcoded logic
- **Namespace isolation** - All plugin rooms and events are automatically prefixed to prevent naming collisions between features
- **Flexible filtering** - Plugins validate subscription payloads, apply business rules, and reject invalid requests with custom error messages
- **Transparent namespacing** - Plugins write code as if using raw Socket.IO, unaware of automatic prefixing behind the scenes
- **Observable metrics** - All subscription activity, room membership, and event emissions are tracked for admin monitoring

## How WebSocket Subscriptions Work

1. **Plugin registers subscription handler** during initialization using `context.websocket.onSubscribe()`
2. **Client subscribes to a room** by calling `websocket.subscribe('room-name', optionalPayload)`
3. **WebSocketService routes to plugin** by matching plugin ID and room name
4. **Client is auto-joined** to prefixed room: `plugin:{pluginId}:{roomName}`
5. **Plugin handler validates and processes** subscription request with optional payload
6. **Plugin emits events to rooms** using `context.websocket.emitToRoom()` when relevant data arrives
7. **Clients receive namespaced events** named `{pluginId}:{eventName}` and update UI accordingly

**Important:** Both room names AND event names are automatically prefixed with the plugin ID to prevent collisions in the global Socket.IO namespace.

## Core Capabilities

### 1. Subscription Handlers

Register a custom handler that runs when clients subscribe to a room:

```typescript
context.websocket.onSubscribe(async (socket, roomName, payload) => {
    // roomName comes from client (e.g., 'large-transfer')
    // Client is already auto-joined to 'plugin:whale-alerts:{roomName}'

    const { minAmount = 500_000 } = payload || {};

    // Validate subscription request
    if (minAmount < 0 || minAmount > 100_000_000) {
        throw new Error('Invalid minAmount threshold');
    }

    // Store preferences for per-socket filtering (optional)
    socket.data.filters = { minAmount };

    // Send confirmation (event auto-prefixed as 'whale-alerts:subscribed')
    context.websocket.emitToSocket(socket, 'subscribed', { roomName, minAmount });
});
```

**Key points:**
- Handler receives socket, room name (without prefix), and optional payload
- **Client is auto-joined** to the room before handler is called
- Throwing errors rejects the subscription and emits error event to client
- Room names are automatically prefixed (`plugin:whale-alerts:{roomName}`)
- Event names are automatically prefixed (`{pluginId}:{eventName}`)
- Plugins remain unaware of prefixing

### 2. Unsubscribe Handlers

Register cleanup logic when clients unsubscribe:

```typescript
context.websocket.onUnsubscribe(async (socket, roomName, payload) => {
    // roomName comes from client (e.g., 'large-transfer')
    // Client is auto-left from room before this handler runs

    // Clean up socket-specific data
    delete socket.data.filters;

    logger.debug({ socketId: socket.id, roomName }, 'Client unsubscribed');
});
```

**Key points:**
- Handler receives socket, room name (without prefix), and optional payload
- **Client is auto-left** from the room before handler runs
- Errors are logged but don't prevent unsubscription from completing
- Cleanup is best-effort - clients disconnect without always sending unsubscribe events

### 3. Room Management

**NOTE:** With the new auto-join/auto-leave system, manual room management is rarely needed.
Clients are automatically joined/left when subscribing/unsubscribing.

Only use manual room management for advanced scenarios:

```typescript
// Manually join a room (rarely needed - auto-join handles this)
context.websocket.joinRoom(socket, 'high-value-transfers');
// Actual room: 'plugin:my-plugin:high-value-transfers'

// Manually leave a room (rarely needed - auto-leave handles this)
context.websocket.leaveRoom(socket, 'high-value-transfers');

// Check room membership
const members = await context.websocket.getSocketsInRoom('high-value-transfers');
console.log(`${members.size} clients subscribed`);
```

**Key points:**
- **Auto-join/auto-leave** handles most room management automatically
- All room names are plugin-local (no need to manually add plugin ID)
- Rooms are created on-demand when first client joins
- Empty rooms are automatically cleaned up by Socket.IO

### 4. Event Emission

Emit events to rooms or specific sockets:

```typescript
// Emit to all clients in a room
context.websocket.emitToRoom('large-transfer', 'large-transfer', {
    txId: '...',
    amountTRX: 1_500_000
});
// Actual room: 'plugin:whale-alerts:large-transfer'
// Actual event: 'whale-alerts:large-transfer' (BOTH PREFIXED)

// Emit to specific socket (e.g., confirmation)
context.websocket.emitToSocket(socket, 'subscribed', {
    roomName: 'large-transfer',
    status: 'subscribed'
});
// Actual event: 'whale-alerts:subscribed' (PREFIXED)
```

**Key points:**
- **Both room names AND event names** are automatically prefixed with plugin ID
- This prevents collisions in the global Socket.IO event namespace
- Payload can be any JSON-serializable data
- Emit operations are fire-and-forget (no confirmation of receipt)

### 5. Advanced: Raw Socket.IO Access

For rare cases requiring global operations:

```typescript
const io = context.websocket.getRawIO();

// Broadcast to ALL connected clients (bypasses rooms)
io.emit('system:maintenance', { message: 'System restart in 5 minutes' });

// Access server-wide socket count
const sockets = await io.fetchSockets();
console.log(`${sockets.length} total connected clients`);
```

**Warning:** Only use raw IO for advanced scenarios. Prefer namespaced methods for normal plugin operations.

## Frontend Client Usage

Clients subscribe using the `websocket.subscribe()` helper method:

```typescript
import { useEffect } from 'react';

function MyPluginComponent({ context }: { context: IFrontendPluginContext }) {
    useEffect(() => {
        const { websocket } = context;

        // Subscribe to room with configuration
        websocket.subscribe('large-transfer', { minAmount: 500_000 });

        // Listen for events (auto-prefixed with plugin ID)
        const handler = (payload: any) => {
            console.log('Large transfer:', payload);
        };
        websocket.on('large-transfer', handler);

        // Handle subscription confirmation (auto-prefixed)
        const confirmedHandler = (data: any) => {
            console.log('Subscribed successfully:', data);
        };
        websocket.on('subscribed', confirmedHandler);

        // Handle subscription errors (auto-prefixed)
        const errorHandler = (error: any) => {
            console.error('Subscription failed:', error);
        };
        websocket.on('subscription-error', errorHandler);

        // Resubscribe on reconnect
        const reconnectHandler = () => {
            websocket.subscribe('large-transfer', { minAmount: 500_000 });
        };
        websocket.onConnect(reconnectHandler);

        return () => {
            // Unsubscribe and clean up
            websocket.unsubscribe('large-transfer', { minAmount: 500_000 });
            websocket.off('large-transfer', handler);
            websocket.off('subscribed', confirmedHandler);
            websocket.off('subscription-error', errorHandler);
            websocket.offConnect(reconnectHandler);
        };
    }, [context.websocket]);

    return null; // Side-effect only component
}
```

**Best practices:**
- Use `websocket.subscribe()` and `websocket.unsubscribe()` helper methods instead of raw socket.emit
- Always emit subscription immediately (before checking `socket.connected`) so Socket.IO buffers it
- Resubscribe on reconnect using `websocket.onConnect()` to handle automatic reconnections
- Clean up all event listeners in the effect return function
- Event names are automatically prefixed with plugin ID - write clean code without manual prefixing

## Complete Example: Whale Alerts

**Backend (plugin init):**

```typescript
init: async (context: IPluginContext) => {
    // Register subscription handler
    context.websocket.onSubscribe(async (socket, payload) => {
        const { minAmount = 500_000 } = payload;

        if (typeof minAmount !== 'number' || minAmount < 0 || minAmount > 100_000_000) {
            throw new Error('Invalid minAmount threshold (must be 0-100,000,000 TRX)');
        }

        const roomName = `whale-${minAmount}`;
        context.websocket.joinRoom(socket, roomName);

        context.logger.debug({ socketId: socket.id, minAmount }, 'Client subscribed');

        context.websocket.emitToSocket(socket, 'subscribed', {
            minAmount,
            status: 'subscribed'
        });
    });

    // Register unsubscribe handler
    context.websocket.onUnsubscribe(async (socket, payload) => {
        const { minAmount = 500_000 } = payload;
        const roomName = `whale-${minAmount}`;

        context.websocket.leaveRoom(socket, roomName);

        context.logger.debug({ socketId: socket.id }, 'Client unsubscribed');
    });

    // Observer emits to rooms when whale transactions occur
    const observer = createWhaleObserver(context);
}
```

**Backend (observer):**

```typescript
protected async process(transaction: ITransaction): Promise<void> {
    const amount = Number(transaction.payload.amountTRX ?? 0);

    // Emit to all threshold rooms that match
    const thresholds = [500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];

    for (const threshold of thresholds) {
        if (amount >= threshold) {
            const roomName = `whale-${threshold}`;
            context.websocket.emitToRoom(roomName, 'large-transfer', transaction.snapshot);
        }
    }
}
```

**Frontend:**

```typescript
export function WhaleAlertsHandler({ context }: { context: IFrontendPluginContext }) {
    const [minAmount, setMinAmount] = useState(500_000);

    useEffect(() => {
        const { websocket } = context;

        const subscribe = () => {
            websocket.subscribe('large-transfer', { minAmount });
        };

        const handleTransfer = (payload: any) => {
            // Show toast, update Redux, etc.
            console.log('Whale transaction:', payload);
        };

        websocket.on('large-transfer', handleTransfer);
        websocket.onConnect(subscribe);
        subscribe();

        return () => {
            websocket.unsubscribe('large-transfer', { minAmount });
            websocket.off('large-transfer', handleTransfer);
            websocket.offConnect(subscribe);
        };
    }, [context.websocket, minAmount]);

    return null;
}
```

## Monitoring and Debugging

### Admin API Endpoints

The system exposes admin-only endpoints for monitoring WebSocket activity:

- `GET /api/system/websockets/stats` - All plugin statistics
- `GET /api/system/websockets/aggregate` - System-wide aggregates
- `GET /api/system/websockets/plugin/:pluginId` - Specific plugin stats

### Admin UI

Access `/system/websockets` to view:

- Total plugins with WebSocket handlers
- Active subscriptions across all plugins
- Events emitted since startup
- Per-plugin room breakdowns
- Event emission rates
- Subscription error counts

### Backend Logs

All WebSocket activity is logged with structured metadata:

```json
{
  "pluginId": "whale-alerts",
  "socketId": "abc123",
  "minAmount": 500000,
  "roomName": "whale-500000",
  "msg": "Client subscribed to whale alerts"
}
```

Filter logs by plugin ID or socket ID for debugging specific issues.

## Migration from Legacy System

Old centralized subscriptions (still supported):

```typescript
// Old: Hardcoded in WebSocketService.handleSubscription()
if (payload.transactions?.minAmount !== undefined) {
    socket.join(`transactions:large:${payload.transactions.minAmount}`);
}

// Old: Hardcoded emission in observer
websocketService.emit({
    event: 'transaction:large',
    payload: transaction.snapshot
});

// Old: Frontend cleanup with raw socket.emit
socket.emit('unsubscribe', { 'whale-alerts': { minAmount } });
```

New plugin-managed subscriptions:

```typescript
// New: Plugin owns subscription logic
context.websocket.onSubscribe(async (socket, roomName, payload) => {
    const { minAmount } = payload;
    // Client is auto-joined to room before this handler runs
    context.logger.debug({ socketId: socket.id, roomName, minAmount }, 'Client subscribed');
});

// New: Plugin owns unsubscribe logic
context.websocket.onUnsubscribe(async (socket, roomName, payload) => {
    // Client is auto-left from room before this handler runs
    context.logger.debug({ socketId: socket.id, roomName }, 'Client unsubscribed');
});

// New: Plugin emits to namespaced rooms
context.websocket.emitToRoom(`whale-${threshold}`, 'large-transfer', transaction.snapshot);

// New: Frontend cleanup with helper methods
websocket.unsubscribe('large-transfer', { minAmount });
```

**Benefits of migration:**
- Subscription logic lives with the feature code
- Validation and error handling are plugin-specific
- Room names are automatically isolated
- Helper methods simplify frontend code and prevent manual prefixing errors
- No core service modifications needed for new subscription types

## Best Practices

1. **Use helper methods** - Prefer `websocket.subscribe()` and `websocket.unsubscribe()` over raw socket.emit for cleaner code and automatic prefixing
2. **Validate subscription payloads** - Throw descriptive errors for invalid thresholds, missing fields, or malformed data
3. **Use semantic room names** - `whale-500000`, `delegation-energy`, `stake-freeze` are clearer than `room1`, `room2`
4. **Emit to multiple rooms** - A single event can go to multiple threshold rooms (e.g., 500k, 1M, 2M)
5. **Log subscription activity** - Use `context.logger.debug()` for subscription/unsubscribe events
6. **Handle edge cases** - Negative thresholds, missing required fields, type mismatches should throw errors
7. **Send confirmation events** - Emit `subscribed` event back to client so UI can show subscription status
8. **Always unsubscribe in cleanup** - Call `websocket.unsubscribe()` in useEffect return function to properly clean up server-side state
9. **Clean up on disable** - If plugin uses intervals or timers, clear them in the `disable` hook

## Common Patterns

### Dynamic Threshold Rooms

```typescript
context.websocket.onSubscribe(async (socket, payload) => {
    const { minAmount = 500_000 } = payload;

    // Round to nearest 100k for room consolidation
    const roundedAmount = Math.round(minAmount / 100_000) * 100_000;
    const roomName = `whale-${roundedAmount}`;

    context.websocket.joinRoom(socket, roomName);
});
```

### Multi-Room Subscriptions

```typescript
context.websocket.onSubscribe(async (socket, payload) => {
    const { tokens = [] } = payload;

    // Join one room per token
    for (const token of tokens) {
        context.websocket.joinRoom(socket, `token-${token}`);
    }
});
```

### User-Specific Rooms

```typescript
// Future: When user authentication exists
context.websocket.onSubscribe(async (socket, payload) => {
    const { userId } = payload;

    // Validate user owns this subscription
    const user = await validateUser(userId);
    if (!user) {
        throw new Error('Invalid user ID');
    }

    context.websocket.joinRoom(socket, `user-${userId}`);
});
```

## Troubleshooting

### Subscription not working

1. Check backend logs for subscription errors
2. Verify plugin ID matches between frontend and backend
3. Confirm payload structure matches handler expectations
4. Test subscription handler throws on invalid input

### Events not received

1. Check event name includes plugin prefix (`whale-alerts:large-transfer`)
2. Verify room membership using `getSocketsInRoom()`
3. Confirm observer actually emits events (check logs)
4. Test with raw Socket.IO tools (e.g., socket.io-client CLI)

### Memory leaks

1. Ensure all event listeners are removed in cleanup functions
2. Verify unsubscribe calls `leaveRoom()` for all joined rooms
3. Monitor room count in admin UI - should not grow indefinitely
4. Check for duplicate subscriptions on component remounts

### High error counts

1. Review subscription handler validation logic
2. Check frontend sends correctly formatted payloads
3. Add error logging with full payload for debugging
4. Test edge cases (null, undefined, wrong types)

## Future Enhancements

- **User authentication** - Restrict subscriptions based on user permissions
- **Rate limiting** - Prevent abuse by limiting subscription requests per socket
- **Persistent subscriptions** - Store user preferences in database for auto-resubscribe
- **Subscription quotas** - Limit number of concurrent subscriptions per user/plugin
- **Wildcard rooms** - Support patterns like `whale-*` for bulk subscriptions
- **Subscription analytics** - Track popular thresholds, peak subscription times, churn rates

## Reference Files

**Type definitions:**
- `packages/types/src/observer/IPluginWebSocketManager.ts` - Manager interface
- `packages/types/src/observer/IPluginWebSocketStats.ts` - Statistics interfaces
- `packages/types/src/observer/IPluginContext.ts` - Updated context with websocket field

**Backend infrastructure:**
- `apps/backend/src/services/plugin-websocket-manager.ts` - Manager implementation
- `apps/backend/src/services/plugin-websocket-registry.ts` - Statistics registry
- `apps/backend/src/services/websocket.service.ts` - Updated routing logic
- `apps/backend/src/loaders/plugins.ts` - Manager injection during plugin load

**Frontend:**
- `apps/frontend/app/(core)/system/websockets/page.tsx` - Admin monitoring UI
- `packages/plugins/whale-alerts/src/frontend/WhaleAlertsToastHandler.tsx` - Example client implementation showing direct Socket.IO event handling with toast notifications

**Example plugin:**
- `packages/plugins/whale-alerts/src/backend/backend.ts` - Subscription handler registration
- `packages/plugins/whale-alerts/src/backend/whale-detection.observer.ts` - Room-based event emission
