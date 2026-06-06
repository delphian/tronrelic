# Widget Components and SSR

Frontend widget authoring — exporting components, the SSR + Live Updates pattern as it applies to widgets, and hydration gotchas. For zones and registration see [plugins-widget-zones.md](./plugins-widget-zones.md) and [plugins-widget-zones-registration.md](./plugins-widget-zones-registration.md).

## Why This Matters

Widgets are extra vulnerable to hydration mismatch: SSR data arrives via the widget type's data fetcher, but a component that re-fetches on mount or initializes empty state renders blank on the client while the server rendered content. React aborts hydration and the widget either flashes empty or fails outright. The rules below close that gap.

## Component Registry

Each plugin exports a `widgetComponents` map from `src/frontend/widgets/index.ts`. Keys must match backend widget IDs exactly. The plugin's `build:frontend` step compiles this to `dist/frontend/widgets/index.js` and `package.json` advertises it via `exports."./frontend/widgets"`. The `npm run generate:plugins` registry generator reads the exports map and emits static imports into `widgets.generated.ts`. Re-run that command after adding or renaming a widget.

```typescript
// src/plugins/trp-my-plugin/src/frontend/widgets/index.ts
import type { ComponentType } from 'react';
import { MyFeedWidget } from './MyFeedWidget';

/**
 * Widget component registry for this plugin.
 * Keys must match widget IDs used in backend registration.
 */
export const widgetComponents: Record<string, ComponentType<{ data: unknown }>> = {
    'my-plugin:feed': MyFeedWidget
};
```

If no component is registered for a widget ID, dev mode falls back to a JSON dump; production renders nothing.

## IWidgetComponentProps

```typescript
interface IWidgetComponentProps {
    data: unknown;                   // SSR-fetched payload from the widget type's defaultDataFetcher
    context: IFrontendPluginContext; // UI primitives, API client, WebSocket
    route: string;                   // Current URL, e.g. '/u/TXyz...'
    params: Record<string, string>;  // Extracted route params
}
```

## SSR + Live Updates for Widgets

The full pattern lives in [react.md](../frontend/react/react.md#ssr--live-updates-pattern). Widget specifics:

1. Add `'use client'` (required for `useState`/`useEffect`).
2. Initialize state directly from `data`: `useState(data as MyType)` — never `useState([])` followed by a fetch.
3. No loading state on initial render; data is already present.
4. WebSocket subscriptions go in `useEffect`, after hydration.
5. Subscribe to plugin-namespaced event names through the WebSocket on `context`.

```tsx
// src/plugins/trp-whale-alerts/src/frontend/widgets/RecentWhalesWidget.tsx
'use client';
import { useEffect, useState } from 'react';
import type { IWidgetComponentProps } from '@/types';

interface WhaleData { transactions: Array<{ txId: string; amountTRX: number }>; count: number; }

export function RecentWhalesWidget({ data, context }: IWidgetComponentProps) {
    const [whaleData, setWhaleData] = useState<WhaleData>(data as WhaleData);

    useEffect(() => {
        const handler = (tx: WhaleData['transactions'][number]) => {
            setWhaleData(prev => ({
                transactions: [tx, ...prev.transactions].slice(0, 10),
                count: prev.count + 1
            }));
        };
        // Subscribe via context.websocket — see plugins-websocket-subscriptions.md
        return () => { /* unsubscribe */ };
    }, [context]);

    if (!whaleData.transactions.length) {
        return <div className="surface surface--padding-md text-muted">No recent activity</div>;
    }
    return (
        <div className="surface">
            {whaleData.transactions.map(tx => (
                <div key={tx.txId} className="surface--padding-sm">{tx.amountTRX.toLocaleString()} TRX</div>
            ))}
        </div>
    );
}
```

## Hydration Gotchas

| Trigger | Symptom | Fix |
|---------|---------|-----|
| `useState([])` then fetch in `useEffect` | Empty client render vs populated server render | Initialize from `data` prop |
| `new Date().toLocaleString()` in render | Server (UTC) vs client (local) text mismatch | `<ClientTime>` or `isMounted` gate |
| `Math.random()` for keys | Different keys per render | Use stable IDs from data |
| `window`, `localStorage` in render body | Undefined on server | Read in `useEffect` only |

For anything that legitimately must differ between server and client (e.g. user-locale timestamps), defer rendering until after hydration:

```tsx
const [isMounted, setIsMounted] = useState(false);
useEffect(() => setIsMounted(true), []);
// ...
{isMounted ? new Date(item.updatedAt).toLocaleString() : item.updatedAt}
```

React 18 dev mode prints the exact mismatched element (`Warning: Text content did not match. Server: "..." Client: "..."`) — fix by deferring or by switching to `<ClientTime>`.

## Regenerating the Registry

```bash
npm run generate:plugins
```

Run after adding, renaming, or removing a widget component. The generator scans every plugin's `src/frontend/widgets/index.ts` and rewrites `widgets.generated.ts` with static imports.

## Related

- [react.md](../frontend/react/react.md) — Foundational SSR + Live Updates pattern
- [ui-ssr-hydration.md](../frontend/ui/ui-ssr-hydration.md) — `ClientTime`, two-phase rendering
- [plugins-frontend-context.md](./plugins-frontend-context.md) — `IFrontendPluginContext`
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) — Plugin-namespaced WebSocket events
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Frontend build pipeline
