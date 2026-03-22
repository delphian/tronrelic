# SSR Hydration Error Prevention

TronRelic uses Next.js Server-Side Rendering where components render twice: once on the server (Node.js) and once on the client (browser). If these renders produce different HTML, React throws a hydration error. This document covers the common causes and solutions.

## Why This Matters

Hydration errors break pages — React may flash incorrect content, lose interactivity, or fail entirely. The most common cause in TronRelic is timezone-dependent rendering: the server renders dates in UTC while the client renders in the user's local timezone, producing different HTML.

**Prerequisite:** All public-facing components must follow the SSR + Live Updates pattern. See [react.md](../react/react.md#ssr--live-updates-pattern) for the complete implementation guide. This document covers hydration error prevention specifically.

## Timezone-Dependent Rendering

**Problem:** Dates render differently on server (UTC) vs client (local timezone):

```tsx
// Bad - causes hydration mismatch
<td>{new Date(market.lastUpdated).toLocaleTimeString()}</td>
// Server: "14:30:00 UTC" | Client: "09:30:00 CST"
```

**Solution:** Use the `ClientTime` component for all timestamp display:

```tsx
import { ClientTime } from '../../components/ui/ClientTime';

<td>
    <ClientTime date={market.lastUpdated} format="time" />
</td>
```

`ClientTime` renders a placeholder (`—`) during SSR, then shows the formatted time after mounting on the client. Server and client HTML match perfectly.

**Available formats:** `"time"` (2:30:15 PM), `"datetime"` (1/15/2025, 2:30:15 PM), `"date"` (1/15/2025).

## Other Common Hydration Causes

**Browser-only APIs during render:**

```tsx
// Bad - crashes on server
const isMobile = window.innerWidth < 768;

// Good - defer to useEffect
const [isMobile, setIsMobile] = useState(false);
useEffect(() => setIsMobile(window.innerWidth < 768), []);
```

**Random values in JSX:**

```tsx
// Bad - different ID each render
<div id={`tooltip-${Math.random()}`}>

// Good - stable ID across renders
import { useId } from 'react';
const tooltipId = useId();
<div id={tooltipId}>
```

**localStorage during render:**

```tsx
// Bad - undefined on server
const theme = localStorage.getItem('theme');

// Good - initialize as null, update in useEffect
const [theme, setTheme] = useState<string | null>(null);
useEffect(() => setTheme(localStorage.getItem('theme')), []);
```

## Two-Phase Rendering for Real-Time Data

For charts and live dashboards where `ClientTime` is insufficient (e.g., chart axis formatters), use two-phase rendering: show timezone-agnostic content initially, switch to timezone-specific content after live data flows.

**Phase 1 (SSR + first client render):** Show relative time labels ("Now", "2h ago") — identical on server and client.

**Phase 2 (after WebSocket connects):** Switch to absolute timestamps ("10:31 PM") — only renders client-side after hydration is complete.

### Implementation

Track when live data starts flowing:

```tsx
const [hasReceivedLiveData, setHasReceivedLiveData] = useState(false);
const realtime = useRealtimeStatus();

useEffect(() => {
    if (realtime.label === 'Live' && lastUpdated) {
        setHasReceivedLiveData(true);
    }
}, [realtime.label, lastUpdated]);
```

Conditionally format based on the flag:

```tsx
xAxisFormatter={(date) => {
    if (!hasReceivedLiveData) {
        const diffHours = Math.floor((Date.now() - date.getTime()) / 3600000);
        if (diffHours === 0) return 'Now';
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${Math.floor(diffHours / 24)}d ago`;
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}}
```

### When to Use Each Pattern

| Scenario | Pattern |
|----------|---------|
| Static timestamps in tables/lists | `ClientTime` component |
| Chart axis formatters, live dashboards | Two-phase rendering |
| Client-only components (no SSR) | Direct `toLocaleTimeString()` |
| Non-timezone data (block numbers, hashes) | No special handling needed |

### Reference Implementation

The `CurrentBlock` component (`src/frontend/features/blockchain/components/CurrentBlock/CurrentBlock.tsx`) demonstrates two-phase rendering with `useRealtimeStatus()` detection and conditional chart axis formatting.

## Widget Component Hydration

Widget components receive SSR-fetched data via the `data` prop. Initialize state from this prop to prevent hydration mismatches:

```tsx
// Correct - initialize from SSR data
export function MyWidget({ data }: { data: unknown }) {
    const [items, setItems] = useState((data as MyData).items);
    return <div>{items.map(i => <p key={i.id}>{i.text}</p>)}</div>;
}

// Wrong - empty initial state causes mismatch
export function MyWidget({ data }: { data: unknown }) {
    const [items, setItems] = useState<Item[]>([]);
    useEffect(() => { fetch('/api/items').then(r => r.json()).then(setItems); }, []);
    return <div>{items.map(i => <p key={i.id}>{i.text}</p>)}</div>;
}
```

The wrong pattern renders empty on the client while the server rendered actual data — React detects the mismatch and throws.

For browser-only rendering within widgets (user timezone, localStorage), use the `isMounted` pattern:

```tsx
const [isMounted, setIsMounted] = useState(false);
useEffect(() => setIsMounted(true), []);

return (
    <span>
        {isMounted ? new Date(item.updatedAt).toLocaleString() : item.updatedAt}
    </span>
);
```

## Further Reading

- [react.md](../react/react.md#ssr--live-updates-pattern) - Complete SSR + Live Updates implementation guide
- [plugins-widget-zones.md](../../plugins/plugins-widget-zones.md) - Widget component SSR patterns and data flow
- [ui-scss-modules.md](./ui-scss-modules.md) - Component styling patterns
