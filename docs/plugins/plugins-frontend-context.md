# Plugin Frontend Context

This document explains how frontend plugins access UI components, API clients, charts, and WebSocket connections through dependency injection rather than direct imports.

## Why Frontend Context Exists

Frontend plugins located in `packages/plugins/` cannot import directly from `apps/frontend/` because:

- **Cross-workspace imports fail** - Next.js module resolution doesn't support relative paths across workspace boundaries
- **Build errors occur** - Paths like `../../../../../../apps/frontend/lib/api` break in Turbopack
- **Tight coupling emerges** - Direct imports make plugins dependent on frontend app internals
- **Framework independence is lost** - Plugins should depend on interfaces, not implementations

The frontend plugin context solves this by **injecting dependencies** into plugin components, mirroring the backend plugin pattern where `IPluginContext` provides services like `observerRegistry` and `database`.

## What Frontend Context Provides

Every frontend plugin component and page receives `IFrontendPluginContext` as a prop, containing:

### 1. Layout Components (`context.layout`)

Structural components for page layout that provide consistent spacing, responsive behavior, and semantic page structure:

```typescript
interface ILayoutComponents {
    Page: ComponentType<{
        children: React.ReactNode;
        className?: string;
    }>;
    PageHeader: ComponentType<{
        title: React.ReactNode;
        subtitle?: React.ReactNode;
        children?: React.ReactNode;
        className?: string;
    }>;
    Stack: ComponentType<{
        children: React.ReactNode;
        gap?: 'sm' | 'md' | 'lg';
        direction?: 'vertical' | 'horizontal';
        className?: string;
    }>;
    Grid: ComponentType<{
        children: React.ReactNode;
        columns?: 2 | 3 | 'responsive';
        gap?: 'sm' | 'md' | 'lg';
        className?: string;
    }>;
    Section: ComponentType<{
        children: React.ReactNode;
        gap?: 'sm' | 'md' | 'lg';
        className?: string;
    }>;
}
```

**Why layout components instead of CSS classes:** Layout components provide TypeScript safety, IDE autocomplete, and encapsulated responsive behavior. Using `<layout.Stack gap="md">` catches typos at compile time; CSS class `.stack--md` fails silently. Plugin pages should use these components for all structural layout.

### 2. UI Components (`context.ui`)

Pre-configured UI components ready to use:

```typescript
interface IUIComponents {
    Card: ComponentType<{
        children?: React.ReactNode;
        tone?: 'default' | 'muted' | 'accent';
        padding?: 'none' | 'sm' | 'md' | 'lg';
    }>;
    Badge: ComponentType<{
        children?: React.ReactNode;
        tone?: 'default' | 'neutral' | 'success' | 'warning' | 'danger';
    }>;
    Skeleton: ComponentType<{
        width?: string | number;
        height?: string | number;
    }>;
    Button: ComponentType<{
        children?: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        variant?: 'primary' | 'secondary' | 'ghost';
    }>;
    Input: ComponentType<{ /* standard input props */ }>;
}
```

### 3. Chart Components (`context.charts`)

Data visualization components:

```typescript
interface IChartComponents {
    LineChart: ComponentType<{
        series: Array<{
            id: string;
            label: string;
            data: Array<{ date: string; value: number }>;
            color?: string;
        }>;
        yAxisFormatter?: (value: number) => string;
        emptyLabel?: string;
    }>;
}
```

### 4. API Client (`context.api`)

Pre-configured HTTP client with automatic base URL and error handling:

```typescript
interface IApiClient {
    get<T>(path: string, params?: Record<string, any>): Promise<T>;
    post<T>(path: string, body?: any): Promise<T>;
    put<T>(path: string, body?: any): Promise<T>;
    delete<T>(path: string): Promise<T>;
}
```

### 5. WebSocket Client (`context.websocket`)

Access to the shared Socket.IO connection:

```typescript
interface IWebSocketClient {
    socket: Socket;
    isConnected: () => boolean;
}
```

### 6. User State Hook (`context.useUser`)

Reactive access to the current user's identity and wallet information:

```typescript
interface IPluginUserState {
    userId: string | null;           // User's UUID
    isRegistered: boolean;           // Has at least one verified wallet
    isLoggedIn: boolean;             // UI feature gate
    wallets: IPluginWalletLink[];    // All linked wallets (verified and unverified)
    primaryWallet: string | null;    // Primary wallet address
    initialized: boolean;            // Whether user state has loaded
}

interface IPluginWalletLink {
    address: string;                 // TRON address (base58)
    verified: boolean;               // Cryptographically verified via signature
    isPrimary: boolean;              // Is this the primary wallet
    linkedAt: string;                // ISO timestamp
    lastUsed: string;                // ISO timestamp
    label?: string;                  // User-assigned label
}
```

**Why `useUser` exists:** Plugins need to gate features based on user registration status without coupling to Redux store internals. The hook provides a stable interface that won't break plugins when the core user module is refactored.

**Wallet states (in order of progression):**
1. No wallets - `wallets.length === 0`
2. Claimed but unverified - `wallets.some(w => !w.verified)`
3. At least one verified - `wallets.some(w => w.verified)` (same as `isRegistered`)

**Example - Feature gating based on registration:**

```typescript
export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui, useUser, useModal } = context;
    const { isRegistered, wallets } = useUser();
    const modal = useModal();

    const handlePremiumFeature = () => {
        if (!isRegistered) {
            modal.open({
                title: 'Wallet Verification Required',
                content: <p>Verify your wallet to access this feature.</p>,
                size: 'sm'
            });
            return;
        }
        // Proceed with premium feature
    };

    return (
        <layout.Page>
            <layout.PageHeader title="My Plugin" />
            <ui.Card>
                <ui.Button onClick={handlePremiumFeature}>
                    Premium Feature
                    {!isRegistered && <LockIcon />}
                </ui.Button>
            </ui.Card>
        </layout.Page>
    );
}
```

## Using the Context in Plugin Pages

Plugin pages receive the context as a prop and destructure what they need:

```typescript
import type { IFrontendPluginContext } from '@tronrelic/types';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui, charts, api, websocket } = context;
    const [data, setData] = useState([]);

    useEffect(() => {
        // Fetch data using injected API client
        async function loadData() {
            const result = await api.get('/plugins/my-plugin/data');
            setData(result.items);
        }
        void loadData();
    }, [api]);

    return (
        <layout.Page>
            <layout.PageHeader title="My Plugin Dashboard" />
            <ui.Card>
                <charts.LineChart
                    series={[{
                        id: 'my-data',
                        label: 'Activity',
                        data: data
                    }]}
                />
            </ui.Card>
        </layout.Page>
    );
}
```

## Using the Context in Plugin Components

Side-effect components (toast handlers, event listeners) also receive context:

```typescript
import type { IFrontendPluginContext } from '@tronrelic/types';

export function MyPluginHandler({ context }: { context: IFrontendPluginContext }) {
    const { websocket } = context;

    useEffect(() => {
        const handler = (payload: any) => {
            console.log('Received event:', payload);
        };

        websocket.socket.on('my:event', handler);
        return () => {
            websocket.socket.off('my:event', handler);
        };
    }, [websocket]);

    return null; // Side-effect only, no UI
}
```

### Reliable WebSocket Subscriptions

React Strict Mode mounts components twice in development, and Socket.IO queues emits until the transport upgrades. If a plugin only emits after checking `socket.connected`, the first subscription can be lost in the gap between those two behaviours. Prevent silent subscription failures by following this pattern:

1. **Emit immediately.** Call `socket.emit('subscribe', payload)` as soon as the effect runs. Socket.IO buffers it until the connection is live, so the backend always receives the request.
2. **Resubscribe on reconnect.** Register the same emit logic on the `connect` event to restore room membership after automatic reconnects.
3. **Unregister cleanly.** Remove both the event listener and the `connect` handler inside the cleanup function to avoid duplicate handlers after remounts.

```typescript
useEffect(() => {
    const socket = context.websocket.socket;
    if (!socket) {
        return undefined;
    }

    const handleEvent = (payload: any) => {
        // update local state here
    };

    const subscribe = () => {
        socket.emit('subscribe', { transactions: { minAmount: 0 } });
    };

    socket.on('transaction:large', handleEvent);
    socket.on('connect', subscribe);
    subscribe(); // fire once immediately so the first handshake is captured

    return () => {
        socket.off('transaction:large', handleEvent);
        socket.off('connect', subscribe);
    };
}, [context.websocket.socket]);
```

This structure is resilient to the strict-mode double-mount behaviour we observed in whale-alert development: the immediate emit guarantees the first subscription, while the `connect` handler keeps the component subscribed after any reconnection.

## Complete Plugin Example

Here's a complete plugin demonstrating all context features:

```typescript
// packages/plugins/example-analytics/src/frontend/frontend.ts
import { definePlugin } from '@tronrelic/types';
import { exampleAnalyticsManifest } from '../manifest';
import { AnalyticsPage } from './AnalyticsPage';
import { AnalyticsEventHandler } from './AnalyticsEventHandler';

export const exampleAnalyticsFrontendPlugin = definePlugin({
    manifest: exampleAnalyticsManifest,
    component: AnalyticsEventHandler,

    menuItems: [
        {
            label: 'Analytics',
            href: '/analytics',
            icon: 'BarChart3',
            order: 40
        }
    ],

    pages: [
        {
            path: '/analytics',
            component: AnalyticsPage,
            title: 'Analytics Dashboard'
        }
    ]
});
```

```typescript
// packages/plugins/example-analytics/src/frontend/AnalyticsPage.tsx
'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';

interface MetricData {
    date: string;
    value: number;
}

export function AnalyticsPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui, charts, api } = context;
    const [metrics, setMetrics] = useState<MetricData[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadMetrics() {
            try {
                const data = await api.get<{ metrics: MetricData[] }>(
                    '/plugins/example-analytics/metrics',
                    { days: 30 }
                );
                setMetrics(data.metrics);
            } catch (error) {
                console.error('Failed to load metrics:', error);
            } finally {
                setLoading(false);
            }
        }
        void loadMetrics();
    }, [api]);

    if (loading) {
        return (
            <layout.Page>
                <ui.Skeleton height="400px" />
            </layout.Page>
        );
    }

    return (
        <layout.Page>
            <layout.PageHeader title="Analytics Dashboard">
                <ui.Badge tone="success">{metrics.length} data points</ui.Badge>
            </layout.PageHeader>

            <ui.Card>
                <layout.Stack gap="md">
                    <h2>Activity Metrics</h2>
                    <charts.LineChart
                        series={[{
                            id: 'activity',
                            label: 'Daily Activity',
                            data: metrics,
                            color: '#7C9BFF'
                        }]}
                        yAxisFormatter={(value: number) => value.toLocaleString()}
                        emptyLabel="No activity data available"
                    />
                </layout.Stack>
            </ui.Card>
        </layout.Page>
    );
}
```

```typescript
// packages/plugins/example-analytics/src/frontend/AnalyticsEventHandler.tsx
'use client';

import { useEffect } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';

export function AnalyticsEventHandler({ context }: { context: IFrontendPluginContext }) {
    const { websocket } = context;

    useEffect(() => {
        const handler = (payload: any) => {
            console.log('Analytics event received:', payload);
            // Process analytics events here
        };

        // Use helper method - automatically prefixes event with plugin ID
        websocket.on('update', handler);

        // Subscribe to the analytics plugin
        websocket.subscribe('example-analytics');

        return () => {
            websocket.off('update', handler);
        };
    }, [websocket]);

    return null;
}
```

## API Client Details

The injected API client automatically handles:

- **Base URL resolution** - Uses `NEXT_PUBLIC_API_URL` environment variable
- **Request formatting** - Automatically stringifies JSON bodies
- **Error handling** - Throws errors for non-2xx responses
- **Type safety** - Supports generic type parameters for response typing

### Making API Requests

```typescript
// GET request with query parameters
const data = await context.api.get('/plugins/my-plugin/items', {
    limit: 10,
    offset: 0,
    sort: 'desc'
});

// POST request with body
const result = await context.api.post('/plugins/my-plugin/items', {
    title: 'New Item',
    value: 42
});

// PUT request to update
await context.api.put('/plugins/my-plugin/items/123', {
    title: 'Updated Title'
});

// DELETE request
await context.api.delete('/plugins/my-plugin/items/123');
```

### Type-Safe API Calls

Use TypeScript generics to type API responses:

```typescript
interface PluginData {
    items: Array<{ id: string; value: number }>;
    total: number;
}

const response = await context.api.get<PluginData>('/plugins/my-plugin/data');
// response.items is typed as Array<{ id: string; value: number }>
// response.total is typed as number
```

## WebSocket Usage

The WebSocket client provides access to the shared Socket.IO connection with **automatic event namespacing** to prevent collisions between plugins.

**For comprehensive WebSocket subscription management** (custom rooms, subscription handlers, validation), see **[Plugin WebSocket Subscriptions](./plugins-websocket-subscriptions.md)**. This section covers basic frontend event listening patterns.

### Helper Methods

The WebSocket client provides helper methods that automatically prefix event names with your plugin ID:

- `websocket.on(event, handler)` - Subscribe to namespaced events
- `websocket.off(event, handler)` - Unsubscribe from events
- `websocket.once(event, handler)` - Subscribe once (auto-unsubscribes)
- `websocket.subscribe(pluginId, payload)` - Subscribe to plugin's real-time updates
- `websocket.onConnect(handler)` - Subscribe to connection/reconnection events
- `websocket.offConnect(handler)` - Unsubscribe from connection events
- `websocket.isConnected()` - Check if currently connected
- `websocket.socket` - Access raw Socket.IO client for advanced use cases

### Subscribing to Events

**Recommended approach** using helper methods with automatic prefixing:

```typescript
useEffect(() => {
    const handler = (payload: any) => {
        // Handle real-time event
        console.log('Received:', payload);
    };

    // Subscribe to event (automatically prefixed with plugin ID)
    context.websocket.on('large-transfer', handler);

    // Cleanup on unmount
    return () => {
        context.websocket.off('large-transfer', handler);
    };
}, [context.websocket]);
```

**Alternative** using raw socket (requires manual prefixing):

```typescript
useEffect(() => {
    const handler = (payload: any) => {
        console.log('Received:', payload);
    };

    // Must manually include plugin prefix
    context.websocket.socket.on('my-plugin:event', handler);

    return () => {
        context.websocket.socket.off('my-plugin:event', handler);
    };
}, [context.websocket]);
```

### Subscribing to Plugin Rooms

Plugins can define multiple rooms that clients subscribe to. The room name is automatically
prefixed with the plugin ID on the backend to create: `plugin:{pluginId}:{roomName}`.

```typescript
useEffect(() => {
    // Subscribe to a default room
    context.websocket.subscribe('whale-alerts');

    // Subscribe to a specific room with configuration
    context.websocket.subscribe('high-value', { minAmount: 1_000_000 });

    // Subscribe to multiple rooms in the same plugin
    context.websocket.subscribe('large-transfer');
    context.websocket.subscribe('medium-value', { minAmount: 100_000 });

    return () => {
        // Unsubscribe handled automatically
    };
}, [context.websocket]);
```

### Handling Connection Events

Use `onConnect` to resubscribe after reconnection:

```typescript
useEffect(() => {
    const { websocket } = context;

    const subscribe = () => {
        websocket.subscribe('large-transfer', { minAmount: 500_000 });
        console.log('Subscribed to large-transfer room');
    };

    // Subscribe on initial mount
    subscribe();

    // Resubscribe on reconnect
    websocket.onConnect(subscribe);

    return () => {
        websocket.offConnect(subscribe);
    };
}, [context.websocket]);
```

### Checking Connection Status

```typescript
const isConnected = context.websocket.isConnected();

if (!isConnected) {
    console.warn('WebSocket not connected, events may be delayed');
}
```

### Event Naming Convention

When using helper methods, **event names are automatically prefixed** with your plugin ID. Use simple descriptive names:

**With helper methods (recommended):**
- ✅ `websocket.on('update', handler)` → listens for `my-plugin:update`
- ✅ `websocket.on('large-transfer', handler)` → listens for `whale-alerts:large-transfer`
- ❌ `websocket.on('my-plugin:update', handler)` → would listen for `my-plugin:my-plugin:update`

**With raw socket (manual prefixing required):**
- ✅ `websocket.socket.on('my-plugin:update', handler)`
- ✅ `websocket.socket.on('whale-alerts:large-transfer', handler)`
- ❌ `websocket.socket.on('update', handler)` (no prefix, could collide)

## Migration Guide

If you have an existing plugin that imports from `apps/frontend`, follow these steps:

### Step 1: Update Component Signature

**Before:**
```typescript
export function MyPage() {
    // ...
}
```

**After:**
```typescript
export function MyPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui, charts, api, websocket } = context;
    // ...
}
```

### Step 2: Replace Direct Imports

**Before:**
```typescript
import { Card } from '../../../apps/frontend/components/ui/Card';
import { LineChart } from '../../../apps/frontend/features/charts/components/LineChart';
import { getMyData } from '../../../apps/frontend/lib/api';

// In component:
const data = await getMyData();
return <Card><LineChart series={data} /></Card>;
```

**After:**
```typescript
import type { IFrontendPluginContext } from '@tronrelic/types';

// In component with context prop:
const data = await context.api.get('/plugins/my-plugin/data');
return <context.ui.Card><context.charts.LineChart series={data} /></context.ui.Card>;
```

### Step 3: Update Socket Access

**Before:**
```typescript
import { getSocket } from '@tronrelic/frontend/lib/socketClient';

const socket = getSocket();
socket.on('my-plugin:event', handler);
```

**After (recommended - uses helper methods):**
```typescript
// Use helper method - automatically prefixes with plugin ID
context.websocket.on('event', handler);
```

**After (alternative - uses raw socket):**
```typescript
// Use raw socket - must manually include plugin prefix
context.websocket.socket.on('my-plugin:event', handler);
```

### Step 4: Add Plugin Styles with CSS Modules

Create CSS Module files colocated with your plugin components:

**Create** `src/frontend/MyPluginPage.module.css`:
```css
/* Component-specific styles scoped automatically by CSS Modules */
.dashboard {
    display: grid;
    gap: 2rem;
    container-type: inline-size;
}

.card {
    padding: 1rem;
    border-radius: var(--radius-md);
    background: rgba(9, 15, 28, 0.6);
}

@container (min-width: 600px) {
    .dashboard {
        grid-template-columns: repeat(2, 1fr);
    }
}
```

**Import and use** in `src/frontend/MyPluginPage.tsx`:
```typescript
import styles from './MyPluginPage.module.css';
import type { IFrontendPluginContext } from '@tronrelic/types';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    return (
        <div className={styles.dashboard}>
            <div className={styles.card}>
                Card content
            </div>
        </div>
    );
}
```

**Benefits of CSS Modules for plugins:**
- Automatically scoped class names prevent conflicts with core app or other plugins
- Colocated with components for better maintainability
- Tree-shakeable (unused styles are eliminated from bundles)
- Type-safe imports with TypeScript

See [Frontend Component Guide](../frontend/ui/ui-component-styling.md) for complete CSS Modules guidance and styling patterns.

### Step 5: Remove Type Imports

Move any type definitions from frontend to plugin or use inline types:

**Before:**
```typescript
import type { TimeseriesPoint } from '../../../apps/frontend/lib/api';
```

**After:**
```typescript
// Define types locally in the plugin
interface TimeseriesPoint {
    date: string;
    value: number;
}
```

## SSR + Live Updates Pattern

Server-side rendering (SSR) with live data updates is the preferred pattern for plugin UI components. This approach provides instant display without loading flash, while still supporting real-time data changes.

### How It Works

1. **Build time** - Generator creates static imports for plugin components
2. **SSR** - Server renders components with pre-fetched data → HTML sent to browser
3. **Hydration** - React takes over, components become interactive
4. **Live updates** - Components subscribe to WebSocket for real-time data changes

This pattern eliminates loading spinners on initial page load while still supporting dynamic data.

### Component Pattern

Plugin components that render visible UI should follow this pattern:

```typescript
'use client';

import { useState, useEffect } from 'react';

interface MyComponentProps {
    initialData: MyData;  // SSR-provided data
    context: IFrontendPluginContext;
}

export function MyPluginComponent({ initialData, context }: MyComponentProps) {
    const { layout, ui, websocket } = context;

    // Initialize state from SSR data - no loading state needed
    const [data, setData] = useState(initialData);

    useEffect(() => {
        // After hydration, subscribe to live updates
        const handleUpdate = (payload: MyData) => {
            setData(payload);
        };

        websocket.on('update', handleUpdate);
        return () => websocket.off('update', handleUpdate);
    }, [websocket]);

    // Render immediately - data is already present from SSR
    return (
        <layout.Page>
            <layout.PageHeader title="My Plugin" />
            <ui.Card>
                <layout.Stack gap="sm">
                    {data.items.map(item => (
                        <p key={item.id}>{item.title}</p>
                    ))}
                </layout.Stack>
            </ui.Card>
        </layout.Page>
    );
}
```

### Key Principles

1. **Initialize state from SSR data** - Use `useState(initialData)` rather than `useState(null)` with a loading fetch
2. **No loading spinners for initial render** - Data arrives with HTML, component renders immediately
3. **WebSocket subscriptions in useEffect** - Client-side only, runs after hydration
4. **State updates trigger re-renders** - Live data flows through normal React state

### Static Imports for SSR

Plugin components must be statically imported (not lazy-loaded) for SSR availability. The build-time generator scans plugin directories and creates static imports in generated registry files.

Export components from standard locations so the generator can discover them:
- Pages and UI components: `src/frontend/` directory
- Widget components: `src/frontend/widgets/index.ts`

After adding new components, regenerate the registry:

```bash
npm run generate:plugins --workspace apps/frontend
```

## Best Practices

### ✅ Do:

- **Use context for all frontend dependencies** - Layout, UI components, API calls, WebSocket, charts
- **Use layout components for page structure** - `context.layout.Page`, `context.layout.Stack`, `context.layout.Grid`
- **Destructure what you need** - `const { layout, ui, api } = context` keeps code clean
- **Define types locally** - Keep plugin self-contained with its own type definitions
- **Use the API client** - Handles base URLs, headers, and errors automatically
- **Namespace WebSocket events** - Use plugin-specific event names
- **Use CSS Modules for plugin styles** - Create `ComponentName.module.css` files colocated with components
- **Import CSS Modules** - `import styles from './Component.module.css'` in component files
- **Use utility classes from globals.css** - Leverage `.surface`, `.btn`, `.badge` for common patterns
- **Reference CSS variables** - Use `var(--color-border)`, `var(--radius-md)` for consistency
- **Use container queries in CSS Modules** - Component responsiveness based on container width
- **Export widget components from standard location** - `src/frontend/widgets/index.ts` for SSR discovery

### ❌ Don't:

- **Import from apps/frontend** - Will cause build errors and tight coupling
- **Use CSS classes for layout** - Use `context.layout` components instead of `.page`, `.stack`, `.grid` classes
- **Access frontend internals** - Use only what's provided in the context
- **Create your own API client** - Use the injected one for consistency
- **Manage Socket.IO connection** - The app handles connection lifecycle
- **Hard-code API URLs** - The API client resolves base URLs automatically
- **Use global CSS class names** - CSS Modules provide automatic scoping
- **Add plugin styles to globals.css** - Keep plugin CSS colocated with plugin components
- **Use viewport media queries** - Use container queries instead for component-level responsiveness

## Troubleshooting

### "Module not found: Can't resolve '../../apps/frontend/...'"

You're importing from the frontend app directly. Replace with context injection:

```typescript
// ❌ Wrong
import { Card } from '../../apps/frontend/components/ui/Card';

// ✅ Correct
export function MyComponent({ context }: { context: IFrontendPluginContext }) {
    return <context.ui.Card>...</context.ui.Card>;
}
```

### "Property 'ui' does not exist on type 'IFrontendPluginContext'"

Make sure you're importing the type from `@tronrelic/types`:

```typescript
import type { IFrontendPluginContext } from '@tronrelic/types';
```

### Component doesn't receive context prop

Verify your plugin exports use `definePlugin` correctly:

```typescript
export const myFrontendPlugin = definePlugin({
    manifest: myManifest,
    pages: [{
        path: '/my-page',
        component: MyPage  // This receives context automatically
    }]
});
```

### API calls fail with CORS errors

The API client uses the base URL from `NEXT_PUBLIC_API_URL`. Verify it's set in `apps/frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

## Summary

The frontend plugin context enables plugins to:

- Access UI components without cross-workspace imports
- Make API calls with automatic configuration
- Subscribe to WebSocket events through the shared connection
- Render charts and data visualizations
- Stay decoupled from frontend app internals

By following this pattern, plugins remain portable, testable, and independent while gaining full access to the frontend platform's capabilities.
