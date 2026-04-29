# React Component Architecture

TronRelic combines Next.js 14 App Router, Redux, context-based DI, and Socket.IO for real-time blockchain UI. This file covers the architectural patterns; component-specific guides live alongside it in [`docs/frontend/react/`](.).

## Why This Matters

Skipping these patterns produces prop drilling, duplicated WebSocket logic, hydration errors, loading-flash on every page visit, and plugins that cannot extend the UI cleanly. Each rule below traces to a specific class of bug — follow them, link out for depth.

## SSR + Live Updates Pattern

**The foundational rule for every public-facing component.** Render fully on the server with real data, then hydrate for interactivity and live updates. No loading flash on initial render.

The server component fetches data and passes it as a prop. The client component initializes state from that prop and attaches WebSocket subscriptions in `useEffect` after hydration.

```typescript
// app/(core)/markets/page.tsx — Server Component (no 'use client')
export default async function MarketsPage() {
    const response = await fetch(getApiUrl('/markets/compare'));
    const { markets } = await response.json();
    return <MarketDashboard initialMarkets={markets} />;
}

// features/markets/components/MarketDashboard.tsx
'use client';
export function MarketDashboard({ initialMarkets }: { initialMarkets: Market[] }) {
    const [markets, setMarkets] = useState(initialMarkets); // initialize FROM prop
    useEffect(() => {
        socket.on('markets:updated', setMarkets);            // live updates AFTER hydration
        return () => socket.off('markets:updated', setMarkets);
    }, []);
    return <>{markets.map(m => <MarketCard key={m.guid} {...m} />)}</>;
}
```

### Critical Rules

| Rule | Correct | Wrong |
|------|---------|-------|
| Initialize state from props | `useState(initialData)` | `useState([])` then fetch |
| No initial loading state | Render content immediately | "Loading…" spinner on mount |
| Fetch in server component | `async function Page()` | `useEffect(() => fetch())` |
| Client receives data as prop | `<Component data={data} />` | Component fetches its own data |

Initializing with empty state breaks hydration: server HTML contains content, client first render is empty, React refuses to attach. SSR-first keeps server and client output identical.

### When Loading States Are Appropriate

User-triggered actions (Save spinner), pagination/infinite scroll, search results, secondary/optional data. **Never** for initial page render or primary content.

### Redux Compatibility

Redux state is empty during SSR. If a component reads from Redux, accept the SSR data as a prop, sync it on mount, and fall back to the prop until Redux populates.

```typescript
useEffect(() => {
    if (initialData && !data) dispatch(setFeatureData(initialData));
}, [initialData, data, dispatch]);
const displayData = data ?? initialData;
```

### SSR + Live Updates Checklist

- [ ] Server component fetches initial data
- [ ] Client component receives data as prop
- [ ] State initialized from prop: `useState(initialData)`
- [ ] No loading state on initial render
- [ ] Live updates attach in `useEffect` after hydration

## Provider Composition

All providers compose in `src/frontend/app/providers.tsx`. Outer providers must be available to inner ones — Redux first so every component can reach the store; toast/modal next so plugins can call `useToast`/`useModal`.

```typescript
// src/frontend/app/providers.tsx
export function Providers({ children }: { children: ReactNode }) {
    return (
        <Provider store={store}>                  {/* Redux */}
            <ToastProvider>                       {/* useToast() */}
                <ModalProvider>                   {/* useModal() */}
                    <FrontendPluginContextProvider>
                        <SocketBridge />
                        <PluginLoader />
                        {children}
                    </FrontendPluginContextProvider>
                </ModalProvider>
            </ToastProvider>
        </Provider>
    );
}
```

All providers are `'use client'` — they manage runtime state.

| Provider | Purpose | Reference |
|----------|---------|-----------|
| Redux `<Provider>` | Global state | `src/frontend/store/` |
| `<ToastProvider>` | Notifications via `useToast()` | `components/ui/ToastProvider/` |
| `<ModalProvider>` | Portal-based modals via `useModal()` | [component-icon-picker-modal.md](./component-icon-picker-modal.md) |
| `<FrontendPluginContextProvider>` | Plugin DI (UI, layout, api, charts, websocket) | [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) |
| `<SchedulerMonitor>` (admin) | BullMQ job control | [component-scheduler-monitor.md](./component-scheduler-monitor.md) |

## Server vs Client Components

Default to server. Upgrade to client only when needed.

| Server Components | Client Components |
|-------------------|-------------------|
| Static content, SSR data fetching | Hooks (`useState`, `useEffect`, `useContext`) |
| SEO-critical pages | WebSocket, user events, Redux |
| Layout shells, metadata | Modal/toast, browser APIs, portals |

Add `'use client'` whenever the file uses hooks, browser APIs (`window`, `localStorage`), WebSocket, event handlers, Redux hooks, or `createPortal`.

**Never mix `await` and hooks in one file.** Server-side `await` and React hooks cannot coexist:

```typescript
// ❌ Hooks fail in server components
export default async function Page() {
    const data = await fetch('/api/data');
    const [state, setState] = useState(data); // ERROR
}

// ✅ Boundary at the file level
export default async function Page() {
    const data = await fetchData();
    return <ClientComponent initialData={data} />;
}
```

## Hydration Error Prevention

Hydration mismatch = server HTML differs from first client render. React aborts and re-renders. Two common causes:

- **Browser APIs during render** — `window`, `document`, `localStorage` are undefined on the server. Read them in `useEffect`, not the render body.
- **Timezone-sensitive dates** — `new Date().toLocaleString()` differs between server (UTC container) and client (local TZ). Use the `<ClientTime>` component.

See [ui-ssr-hydration.md](../ui/ui-ssr-hydration.md) for `<ClientTime>` API and the full rule set.

## Custom Hooks

Create a hook when logic is reused across components, stateful logic is complex, side effects need cleanup, or testing benefits from isolation. Don't create one for single-use logic, pure transformations (use a function), or simple computed values (use `useMemo` inline).

Naming: `use` prefix, camelCase, describe what — not how. Organization: feature-specific in `features/<name>/hooks/`; shared utilities in `lib/hooks/`.

**Compose low-level hooks into high-level ones:**

```typescript
// Low-level: WebSocket subscription
export function useSocketSubscription({ event, room, handler }) {
    const socket = useContext(SocketContext);
    useEffect(() => {
        socket.on(event, handler);
        socket.emit('subscribe', { room });
        return () => {
            socket.off(event, handler);
            socket.emit('unsubscribe', { room });
        };
    }, [event, room, handler, socket]);
    return { isSubscribed: true };
}

// High-level: composes the low-level hook
export function useWhaleTransactions(threshold: number) {
    const dispatch = useAppDispatch();
    const transactions = useAppSelector(state => state.whales.transactions);
    useSocketSubscription({
        event: 'whale:transaction',
        room: `whales:${threshold}`,
        handler: (tx) => dispatch(whaleTransactionReceived(tx))
    });
    return { transactions };
}
```

**List every dependency** in `useEffect` / `useCallback` / `useMemo` arrays. Missing deps cause stale closures. Wrap unstable function deps in `useCallback`.

## Environment Variables

| Variable | Server Components | Client Components |
|----------|-------------------|-------------------|
| `SITE_BACKEND`, other server vars | ✅ Available | ❌ Undefined |
| `NEXT_PUBLIC_*` | ✅ Available | ✅ Available |

**Use the runtime-config APIs.** In SSR (server components, `generateMetadata`) call `getServerConfig()` from `@/lib/serverConfig`; in client code call `getRuntimeConfig()` from `@/lib/runtimeConfig`. The legacy `@/lib/config` module is deprecated — it inlines `NEXT_PUBLIC_*` at build time and breaks universal Docker images. Never read `process.env.*` directly. See [frontend-architecture.md](../frontend-architecture.md#environment-configuration-and-runtime-contexts).

## Composition Over Inheritance

Use `children` for content slots, render props when the child needs parent data, and component props (`renderItem: ComponentType`) when the parent passes a component reference.

**Prefer hooks over HOCs.** HOCs nest deeply and obscure props; hooks compose flat. Use HOCs only for error boundaries, third-party wrapping, or legacy migration.

```typescript
// ❌ HOC nests, hides props
withAuth(MyComponent)

// ✅ Hook is flat and explicit
function MyComponent() {
    const user = useAuth();
    return <div>Welcome {user.name}</div>;
}
```

## Pre-Ship Checklist

- [ ] Server component fetches initial data; client receives it as prop
- [ ] `useState` initialized from prop; no initial loading state
- [ ] Live updates attached in `useEffect` after hydration
- [ ] `'use client'` only when file needs hooks/browser/WebSocket/events/Redux/portals
- [ ] No `window`/`document` in render body — only in `useEffect`
- [ ] Dates rendered via `<ClientTime>`, not `toLocaleString`
- [ ] `process.env.*` never read directly — use `getServerConfig()` (SSR) or `getRuntimeConfig()` (client)
- [ ] Hooks: `use` prefix, all dependencies listed, `useEffect` cleanups returned
- [ ] Plugin components consume `IFrontendPluginContext` (no cross-workspace imports)

## Component Documentation

- [component-icon-picker-modal.md](./component-icon-picker-modal.md) — IconPickerModal + ModalProvider integration
- [component-scheduler-monitor.md](./component-scheduler-monitor.md) — SchedulerMonitor admin panel

## Further Reading

- [frontend.md](../frontend.md) — Frontend overview and module organization
- [frontend-architecture.md](../frontend-architecture.md) — File layout, env config, runtime contexts
- [ui.md](../ui/ui.md) — Design tokens, SCSS Modules, layout primitives
- [ui-ssr-hydration.md](../ui/ui-ssr-hydration.md) — `<ClientTime>` and hydration safety
- [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) — Plugin DI: UI, API, charts, websocket
- [documentation.md](../../documentation.md) — Documentation writing standards
