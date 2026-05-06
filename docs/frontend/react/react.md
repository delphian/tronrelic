# React Component Architecture

TronRelic combines Next.js 14 App Router, Redux, context-based DI, and Socket.IO for real-time blockchain UI. Architectural patterns here; component-specific guides live alongside in [`docs/frontend/react/`](.).

## Why This Matters

Skipping these patterns produces prop drilling, duplicated WebSocket logic, hydration errors, loading-flash on every page visit, and plugins that cannot extend the UI cleanly. Each rule below traces to a specific class of bug — follow them, link out for depth.

## SSR + Live Updates Pattern

**The foundational rule for every public-facing component.** Render fully on the server with real data, then hydrate for interactivity and live updates. No loading flash on initial render.

Server component fetches data and passes it as a prop. Client component initializes state from that prop, hydrates Redux on mount, and subscribes via WebSocket in `useEffect` after hydration.

Canonical implementation — `app/page.tsx` + `features/transactions/components/TransactionFeed/TransactionFeed.tsx`:

```typescript
// app/page.tsx — Server Component
export default async function HomePage() {
    const { apiUrl } = await getServerConfig();
    const response = await fetch(`${apiUrl}/blockchain/latest`, { cache: 'no-store' });
    const { transactions } = await response.json();
    return <TransactionFeed initialTransactions={transactions} />;
}

// features/transactions/components/TransactionFeed/TransactionFeed.tsx
'use client';
export function TransactionFeed({ initialTransactions }: { initialTransactions: TronTransactionDocument[] }) {
    const dispatch = useAppDispatch();
    const transactions = useAppSelector(state => state.transactions.transactions);
    const subscription = useMemo(() => ({ transactions: { minAmount: 10_000 } }), []);

    useSocketSubscription(subscription); // live updates AFTER hydration

    useEffect(() => {
        if (initialTransactions.length) dispatch(setTransactions(initialTransactions));
    }, [dispatch, initialTransactions]);

    return <>{transactions.map(t => <TransactionRow key={t.txID} {...t} />)}</>;
}
```

### Critical Rules

| Rule | Correct | Wrong |
|------|---------|-------|
| Initialize state from props | `useState(initialData)` or hydrate Redux from prop | `useState([])` then fetch |
| No initial loading state | Render content immediately | "Loading…" spinner on mount |
| Fetch in server component | `async function Page()` with `getServerConfig()` | `useEffect(() => fetch())` |
| Client receives data as prop | `<Component initialData={data} />` | Component fetches its own data |

Empty initial state breaks hydration: server HTML has content, client first render is empty, React refuses to attach. SSR-first keeps server and client output identical.

### When Loading States Are Appropriate

User-triggered actions (Save spinner), pagination/infinite scroll, search results, secondary/optional data. **Never** for initial page render or primary content.

### Redux + SSR

Redux state is empty during SSR — the store is created client-side in `providers.tsx`. Components reading from Redux must accept SSR data as a prop, dispatch it on mount, and fall back to the prop until Redux populates:

```typescript
useEffect(() => {
    if (initialData && !data) dispatch(setFeatureData(initialData));
}, [initialData, data, dispatch]);
const displayData = data ?? initialData;
```

Exception: `UserIdentityProvider` preloads Redux from SSR via `buildSSRUserState(ssrUserData)` in `providers.tsx`, so user identity does not flash. Mirror that pattern only when avoiding flash matters more than the added boot-time cost.

## Provider Composition

All providers compose in `src/frontend/app/providers.tsx`. Outer providers must be available to inner ones — Redux first so every component reaches the store; toast/modal next so plugins can call `useToast`/`useModal`; plugin context before `PluginLoader` so plugins resolve their DI; identity before `PluginLoader` so plugins see a known user.

Actual order from `providers.tsx`:

```
<Provider store={store}>            ← Redux, store memoized from ssrUserData
  <ToastProvider>                   ← useToast()
    <ModalProvider>                 ← useModal()
      <FrontendPluginContextProvider>
        <SocketBridge />            ← single Socket.IO client; resends subs on reconnect
        <UserIdentityProvider>      ← bootstraps tronrelic_uid cookie, watches wallet
          <PluginLoader />          ← runs after identity is known
          {children}
        </UserIdentityProvider>
      </FrontendPluginContextProvider>
    </ModalProvider>
  </ToastProvider>
</Provider>
```

All providers are `'use client'` — they manage runtime state.

| Provider | Purpose | Reference |
|----------|---------|-----------|
| Redux `<Provider>` | Global state, preloaded with `ssrUserData` | `src/frontend/store/` |
| `<ToastProvider>` | Notifications via `useToast()` | `components/ui/ToastProvider/` |
| `<ModalProvider>` | Portal-based modals via `useModal()` | [component-icon-picker-modal.md](./component-icon-picker-modal.md) |
| `<FrontendPluginContextProvider>` | Plugin DI (UI, layout, api, charts, websocket) | [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) |
| `<SocketBridge />` | Single shared Socket.IO connection | `components/socket/SocketBridge.tsx` |
| `<UserIdentityProvider>` | Identity cookie bootstrap, wallet watcher | `modules/user/components/UserIdentityProvider.tsx` |
| `<PluginLoader />` | Activates frontend plugins; must run inside identity provider | `components/plugins/PluginLoader.tsx` |

`UserIdentityProvider` imports directly (not via the `modules/user` barrel) — barrels pull component CSS into the layout bundle.

## Server vs Client Components

Default to server. Add `'use client'` only when the file uses hooks, browser APIs (`window`, `localStorage`), WebSocket, event handlers, Redux hooks, or `createPortal`.

**Project-specific gotcha — never mix `await` and hooks in one file.** Server-side `await` and React hooks cannot coexist:

```typescript
// ❌ Hooks fail in async server components
export default async function Page() {
    const data = await fetch('/api/data');
    const [state, setState] = useState(data); // ERROR
}

// ✅ Boundary at the file level — server fetches, client hooks
export default async function Page() {
    const data = await fetchData();
    return <ClientComponent initialData={data} />;
}
```

## Hydration Error Prevention

Hydration mismatch = server HTML differs from first client render. React aborts and re-renders. Two common causes:

- **Browser APIs during render** — `window`, `document`, `localStorage` are undefined on the server. Read them in `useEffect`, not the render body.
- **Timezone-sensitive dates** — `new Date().toLocaleString()` differs between server (UTC container) and client (local TZ). Use `<ClientTime>`.

Full rule set + `<ClientTime>` API: [ui-ssr-hydration.md](../ui/ui-ssr-hydration.md).

## Custom Hooks

Extract a hook when logic is reused, stateful logic is complex, side effects need cleanup, or testing benefits from isolation. Don't extract for single-use logic, pure transformations (use a function), or trivial computed values (use `useMemo` inline).

**Placement:** module-specific hooks in `modules/<name>/hooks/`; cross-cutting utilities in `lib/hooks/`. The legacy `features/<name>/hooks/` directory still holds hooks from before the modules convention — treat it as read-only and put new work in `modules/`.

**Compose low-level hooks into high-level ones.** `useSocketSubscription` is the project's low-level primitive. It accepts a typed `SocketSubscriptions` payload (not `{event, room, handler}`) and dispatches subscription state to Redux internally:

```typescript
useSocketSubscription(
    subscription: SocketSubscriptions | null | false,
    options?: { enabled?: boolean; immediate?: boolean }
): void
```

Real usage from `TransactionFeed.tsx`:

```typescript
const subscription = useMemo(() => ({ transactions: { minAmount: 10_000 } }), []);
useSocketSubscription(subscription);
const transactions = useAppSelector(state => state.transactions.transactions);
```

Memoize the subscription object — passing a fresh identity each render re-registers. Pass `null` or `false` to disable.

**List every dependency** in `useEffect` / `useCallback` / `useMemo` arrays. Missing deps cause stale closures. Wrap unstable function deps in `useCallback`.

## Environment Variables

| Variable class | Server Components | Client Components |
|----------------|-------------------|-------------------|
| `SITE_BACKEND`, other server vars | ✅ Available | ❌ Undefined |
| `NEXT_PUBLIC_*` | ⚠️ Avoid — inlined at build time, breaks universal Docker image | ⚠️ Avoid — same |

**Use the runtime-config APIs.** SSR (server components, `generateMetadata`) calls `getServerConfig()` from `@/lib/serverConfig`; client code calls `getRuntimeConfig()` from `@/lib/runtimeConfig`. The legacy `@/lib/config` module and `getApiUrl()` are deprecated. Never read `process.env.*` directly in components. See [frontend-architecture-runtime-config.md](../frontend-architecture-runtime-config.md).

## Pre-Ship Checklist

- [ ] Server component fetches initial data via `getServerConfig()`; client receives it as prop
- [ ] `useState`/Redux initialized from prop; no initial loading state on primary content
- [ ] Live updates attached in `useEffect` after hydration; `useSocketSubscription` payload memoized
- [ ] `'use client'` only when file needs hooks/browser/WebSocket/events/Redux/portals
- [ ] No `window`/`document` in render body — only in `useEffect`
- [ ] Dates rendered via `<ClientTime>`, not `toLocaleString`
- [ ] `process.env.*` never read directly — `getServerConfig()` (SSR) or `getRuntimeConfig()` (client)
- [ ] New hooks live in `modules/<name>/hooks/` or `lib/hooks/`, not `features/`
- [ ] All `useEffect`/`useCallback`/`useMemo` dependencies listed; cleanup returned where needed
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
