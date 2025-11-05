# React Component Architecture

This document provides a high-level overview of TronRelic's React component patterns and architectural decisions. For detailed component implementation guides, refer to the specialized documentation in the `react/` subdirectory.

## Who This Document Is For

Frontend developers implementing React components, features, or plugins who need to understand TronRelic's React patterns before writing UI code. This includes understanding context providers, hooks, composition patterns, and server vs client component decisions.

## Why This Matters

TronRelic's React architecture solves specific problems that arise when building a complex, real-time blockchain monitoring application:

- **Context providers eliminate prop drilling** - Without centralized state management, modal controls, toast notifications, and plugin APIs would need to be passed through 5-10 component layers
- **Custom hooks encapsulate feature logic** - Without hooks, blockchain subscription logic, WebSocket management, and wallet tracking would duplicate across components
- **Server and client component separation optimizes performance** - Mixing server and client components without understanding the boundary causes hydration errors and unnecessary client-side JavaScript
- **Composition over inheritance enables plugin flexibility** - Without composition patterns, plugins couldn't inject custom UI or extend core components cleanly

Following these patterns ensures your components integrate seamlessly with TronRelic's state management, real-time updates, and plugin system.

## Core React Patterns

### Context Provider System

TronRelic uses React Context for dependency injection and cross-cutting concerns. All providers are composed in a single `Providers` wrapper that establishes the application's runtime environment:

```typescript
// apps/frontend/app/providers.tsx
export function Providers({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>           {/* Redux state management */}
      <ToastProvider>                  {/* Toast notifications */}
        <ModalProvider>                {/* Modal dialogs */}
          <FrontendPluginContextProvider>  {/* Plugin API access */}
            <SocketBridge />           {/* WebSocket sync */}
            <PluginLoader />           {/* Plugin initialization */}
            {children}
          </FrontendPluginContextProvider>
        </ModalProvider>
      </ToastProvider>
    </Provider>
  );
}
```

**Key architectural decisions:**

- **Composition order matters** - Redux wraps everything so all components can access the store; toast/modal providers wrap plugins so plugins can use these APIs
- **Single provider wrapper** - All providers compose in one place (`app/providers.tsx`) making the dependency tree visible at a glance
- **Client-side only** - Providers use `'use client'` directive since they manage runtime state and cannot run during server-side rendering

**See [Component-Specific Providers](#component-specific-providers) for detailed documentation on:**
- ModalProvider - Portal-based modal system with size variants and dismissibility
- ToastProvider - Notification system with success/error/info variants
- FrontendPluginContextProvider - Plugin dependency injection for UI components, API client, charts, and WebSocket

### Custom Hooks Pattern

TronRelic organizes hooks by feature, colocating them with the components that use them. Each hook encapsulates a single responsibility (WebSocket subscription, wallet state, real-time status) and can be composed into more complex hooks.

**Common hook patterns:**

| Hook Type | Purpose | Example |
|-----------|---------|---------|
| **State management hooks** | Access Redux slices | `useWallet()`, `useMarketData()` |
| **Real-time hooks** | WebSocket subscriptions | `useRealtimeStatus()`, `useSocketSubscription()` |
| **API hooks** | Data fetching and mutations | `useTransactionTimeseries()` |
| **UI state hooks** | Component-level state | `useModal()`, `useToast()` |

**Hook organization:**

```
features/accounts/
├── hooks/
│   └── useWallet.ts              # Feature-specific hook
features/realtime/
├── hooks/
│   ├── useRealtimeStatus.ts      # WebSocket connection status
│   └── useSocketSubscription.ts  # Custom event subscriptions
```

**Example: Real-time whale transaction hook**

```typescript
// features/whales/hooks/useWhaleTransactions.ts
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { useSocketSubscription } from '../../realtime/hooks/useSocketSubscription';
import { whaleTransactionReceived } from '../slice';

export function useWhaleTransactions(thresholdTRX: number) {
  const dispatch = useAppDispatch();
  const transactions = useAppSelector(state => state.whales.transactions);

  // Subscribe to WebSocket events
  const { isSubscribed, error } = useSocketSubscription({
    event: 'whale:transaction',
    room: `whales:${thresholdTRX}`,
    payload: { thresholdTRX },
    handler: (transaction) => {
      dispatch(whaleTransactionReceived(transaction));
    }
  });

  return { transactions, isSubscribed, error };
}
```

**See [Custom Hooks Best Practices](#custom-hooks-best-practices) for guidance on:**
- When to create a new hook vs inline logic
- Naming conventions (use-prefixed, camelCase)
- Dependency management and useEffect patterns
- Testing custom hooks

### Server vs Client Components

Next.js 14 App Router supports two component types with different capabilities and performance characteristics. TronRelic uses server components by default for pages and layouts, upgrading to client components only when necessary.

**Decision matrix:**

| Use Server Components | Use Client Components |
|-----------------------|----------------------|
| Static content rendering | WebSocket subscriptions |
| Database queries (SSR) | User interactions (clicks, forms) |
| SEO-critical pages | Real-time updates |
| Layout shells | Modal/toast rendering |
| Metadata generation | Redux state access |

**Server component example:**

```typescript
// app/(dashboard)/markets/page.tsx (no 'use client' directive)
import { getApiUrl } from '@/lib/config';
import { MarketDashboard } from '../../../features/markets';

// Runs on server, fetches data during SSR
export default async function MarketsPage() {
  const response = await fetch(getApiUrl('/markets/compare'));
  const data = await response.json();

  // Server component passes data as props to client component
  return <MarketDashboard markets={data.markets} />;
}
```

**Client component example:**

```typescript
// features/markets/components/MarketDashboard.tsx
'use client';  // Required for interactivity and WebSocket

import { useState } from 'react';
import { useSocketSubscription } from '../../realtime/hooks/useSocketSubscription';

export function MarketDashboard({ markets: initialMarkets }) {
  const [markets, setMarkets] = useState(initialMarkets);

  // Client-only: WebSocket subscription
  useSocketSubscription({
    event: 'markets:updated',
    room: 'markets',
    handler: (updatedMarkets) => setMarkets(updatedMarkets)
  });

  return (
    <div>
      {markets.map(market => <MarketCard key={market.guid} {...market} />)}
    </div>
  );
}
```

**Common mistakes to avoid:**

```typescript
// ❌ BAD - Mixing server and client logic without boundary
export default async function Page() {
  const data = await fetch('/api/data');  // Server-side fetch

  const [state, setState] = useState(data);  // ERROR: Hooks don't work in server components

  return <div>{state}</div>;
}

// ✅ GOOD - Separate concerns with component boundary
export default async function Page() {
  const data = await fetch('/api/data');  // Server-side fetch

  return <ClientComponent initialData={data} />;  // Pass to client component
}

// ClientComponent.tsx
'use client';
export function ClientComponent({ initialData }) {
  const [state, setState] = useState(initialData);  // Now works
  return <div>{state}</div>;
}
```

**See [Next.js Server vs Client Components](#nextjs-server-vs-client-components) for complete guidance on:**
- When to add `'use client'` directive
- Hydration error prevention
- Passing data from server to client components
- Environment variable access in each context

### Composition Patterns

TronRelic favors composition over inheritance for component reusability. Components accept `children`, render props, or component props to enable customization without subclassing.

**Component composition example:**

```typescript
// components/ui/Card/Card.tsx
export interface CardProps {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;  // Render prop for header actions
  className?: string;
}

export function Card({ children, title, actions, className }: CardProps) {
  return (
    <div className={cn(styles.card, className)}>
      {(title || actions) && (
        <header className={styles.card__header}>
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      <div className={styles.card__body}>
        {children}
      </div>
    </div>
  );
}

// Usage with composition
<Card
  title="Market Leaderboard"
  actions={<Button onClick={refresh}>Refresh</Button>}
>
  <MarketTable markets={markets} />
</Card>
```

**Plugin component injection:**

Plugins extend core UI by injecting components through the plugin context:

```typescript
// Plugin frontend code
export const myPluginFrontend = definePlugin({
  manifest: myManifest,
  pages: [
    {
      path: '/my-plugin/dashboard',
      component: MyPluginDashboard  // Plugin component
    }
  ]
});

// MyPluginDashboard.tsx
export function MyPluginDashboard({ context }: { context: IFrontendPluginContext }) {
  const { ui, api, charts } = context;  // Core components injected via context

  return (
    <ui.Card title="Plugin Dashboard">
      <charts.LineChart data={...} />
    </ui.Card>
  );
}
```

**See [Composition Best Practices](#composition-best-practices) for guidance on:**
- When to use children vs render props vs component props
- Plugin component injection patterns
- Higher-order components (HOCs) vs hooks
- Component API design

## Component-Specific Providers

### ModalProvider

Portal-based modal system supporting multiple simultaneous modals, size variants, dismissibility controls, and Redux integration for analytics.

**Key features:**

- **Imperative API** - Open/close modals programmatically without managing state
- **Portal rendering** - Modals render outside component hierarchy for proper z-index stacking
- **Size variants** - `sm`, `md`, `lg`, `xl` for responsive width control
- **Dismissible control** - Optional backdrop clicks and X button for closing
- **Multiple modals** - Supports stacking multiple modals simultaneously
- **Redux integration** - Tracks modal state for analytics and debugging

**Usage example:**

```typescript
import { useModal } from '../../../components/ui/ModalProvider';

function ThemeForm() {
  const { open: openModal, close: closeModal } = useModal();

  const handleOpenPicker = () => {
    const modalId = openModal({
      title: 'Select Icon',
      size: 'lg',
      content: <IconPickerModal onSelect={handleSelect} onClose={() => closeModal(modalId)} />,
      dismissible: true
    });
  };

  return <Button onClick={handleOpenPicker}>Choose Icon</Button>;
}
```

**See [react/component-icon-picker-modal.md](./react/component-icon-picker-modal.md) for a complete example using ModalProvider.**

**Provider location:** `apps/frontend/components/ui/ModalProvider/ModalProvider.tsx`

### SchedulerMonitor

Admin diagnostic tool for monitoring BullMQ scheduled job health, execution history, and runtime configuration. Displays real-time job status tracking with inline controls for enabling/disabling jobs and modifying schedules without backend restarts.

**Key features:**

- **Real-time status tracking** - Color-coded badges (success/failed/running/never run) with auto-refresh every 10 seconds
- **Global health metrics** - Scheduler uptime, success rate, and enabled/disabled state
- **Inline job control** - Enable/disable toggles and editable cron expressions with blur-to-save
- **Job filtering** - Show all jobs or filter by job name/prefix for plugin-scoped views
- **Admin authentication** - Requires admin token from localStorage, directs to /system if missing
- **Persistent configuration** - All changes saved to MongoDB, no backend restart needed

**Props interface:**

```typescript
interface SchedulerJob {
    name: string;
    schedule: string;
    enabled: boolean;
    lastRun: string | null;
    nextRun: string | null;
    status: 'running' | 'success' | 'failed' | 'never_run';
    duration: number | null;
    error: string | null;
}

interface Props {
    token: string;
    jobFilter?: string[] | ((job: SchedulerJob) => boolean);
    sectionTitle?: string;
    hideHealth?: boolean;
}
```

**Usage example:**

```typescript
import { SchedulerMonitor, useSystemAuth } from '../../../features/system';

function SchedulerPage() {
    const { token } = useSystemAuth();
    return <SchedulerMonitor token={token} />;
}

// Plugin-scoped view (filter to specific jobs)
function PluginJobControl() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

    if (!token) {
        return <AuthPrompt href="/system" />;
    }

    return (
        <SchedulerMonitor
            token={token}
            jobFilter={['markets:refresh']}
            sectionTitle="Market Refresh Job"
            hideHealth={true}
        />
    );
}
```

**See [react/component-scheduler-monitor.md](./react/component-scheduler-monitor.md) for complete integration guide and troubleshooting.**

**Component location:** `apps/frontend/features/system/components/SchedulerMonitor/SchedulerMonitor.tsx`

### ToastProvider

Notification system for displaying success, error, info, and warning messages with automatic dismissal and action buttons.

**Key features:**

- **Variant types** - Success, error, info, warning with distinct styling
- **Auto-dismissal** - Configurable timeout (default 5 seconds)
- **Action buttons** - Optional clickable actions in toast content
- **Stacking** - Multiple toasts stack vertically
- **Accessibility** - ARIA live regions for screen reader announcements

**Usage example:**

```typescript
import { useToast } from '../../../components/ui/ToastProvider';

function SaveButton() {
  const { showToast } = useToast();

  const handleSave = async () => {
    try {
      await saveData();
      showToast({
        type: 'success',
        message: 'Settings saved successfully'
      });
    } catch (error) {
      showToast({
        type: 'error',
        message: 'Failed to save settings',
        duration: 7000
      });
    }
  };

  return <Button onClick={handleSave}>Save</Button>;
}
```

**Provider location:** `apps/frontend/components/ui/ToastProvider/ToastProvider.tsx`

### FrontendPluginContextProvider

Dependency injection system for plugins to access core UI components, API client, charts, and WebSocket without cross-workspace imports.

**Key features:**

- **UI component access** - Plugins use shared Card, Button, Badge without importing
- **API client** - Pre-configured axios instance with authentication
- **Chart components** - Reusable LineChart, BarChart, PieChart
- **WebSocket bridge** - Subscribe to real-time events from plugin pages

**Usage in plugins:**

```typescript
import type { IFrontendPluginContext } from '@tronrelic/types';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
  const { ui, api, charts, websocket } = context;

  useEffect(() => {
    websocket.subscribe({
      event: 'my-plugin:update',
      room: 'my-plugin-room',
      handler: (data) => console.log('Update received:', data)
    });
  }, [websocket]);

  return (
    <ui.Card title="Plugin Dashboard">
      <charts.LineChart data={...} />
      <ui.Button onClick={() => api.post('/plugins/my-plugin/action', {})}>
        Trigger Action
      </ui.Button>
    </ui.Card>
  );
}
```

**Provider location:** `apps/frontend/lib/frontendPluginContext.tsx`

**See [plugins-frontend-context.md](../plugins/plugins-frontend-context.md) for complete plugin context documentation.**

## Custom Hooks Best Practices

### When to Create a Hook

Create a custom hook when:

- **Logic is reused across multiple components** - WebSocket subscriptions, wallet state, API fetching
- **Stateful logic is complex** - Multiple useState/useEffect calls that should be encapsulated
- **Side effects need cleanup** - WebSocket connections, timers, subscriptions require cleanup on unmount
- **Testing would benefit from isolation** - Hooks can be tested separately from component rendering

**Do not create hooks for:**

- Single-use logic that's simpler inline
- Pure data transformations (use utility functions instead)
- Simple computed values (use useMemo inline)

### Hook Naming Conventions

- **Always prefix with `use`** - Required for React to recognize hooks
- **CamelCase** - `useWallet`, `useRealtimeStatus`, `useSocketSubscription`
- **Descriptive names** - Name should explain what the hook does, not how it works internally

### Hook Organization

**Feature-specific hooks:**
```
features/accounts/hooks/
└── useWallet.ts              # Account feature logic

features/realtime/hooks/
├── useRealtimeStatus.ts      # WebSocket status
└── useSocketSubscription.ts  # Event subscriptions
```

**Shared hooks:**
```
lib/hooks/
└── useMenuConfig.ts          # Cross-feature utilities
```

### Hook Composition Example

Compose simple hooks into more complex ones:

```typescript
// Low-level hook: WebSocket subscription
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

// High-level hook: Whale transactions (composes low-level hook)
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

### Dependency Array Management

Always include all dependencies in `useEffect`/`useCallback`/`useMemo` dependency arrays:

```typescript
// ❌ BAD - Missing dependencies causes stale closures
useEffect(() => {
  fetchData(userId);  // userId not in dependency array
}, []);

// ✅ GOOD - All dependencies listed
useEffect(() => {
  fetchData(userId);
}, [userId]);

// ✅ GOOD - Stable reference for function dependency
const fetchData = useCallback(async (id: string) => {
  const result = await api.get(`/users/${id}`);
  setData(result);
}, [api]);

useEffect(() => {
  fetchData(userId);
}, [userId, fetchData]);
```

## Next.js Server vs Client Components

### Adding 'use client' Directive

Add `'use client'` at the top of any file that:

- Uses React hooks (`useState`, `useEffect`, `useContext`, etc.)
- Accesses browser APIs (`window`, `document`, `localStorage`)
- Subscribes to WebSocket events
- Handles user interactions (clicks, form submissions)
- Uses Redux hooks (`useAppDispatch`, `useAppSelector`)
- Renders portals (`createPortal`)

**Example requiring 'use client':**

```typescript
'use client';

import { useState } from 'react';
import { useModal } from '../../../components/ui/ModalProvider';

export function InteractiveComponent() {
  const [count, setCount] = useState(0);  // Hook requires client
  const { open } = useModal();            // Context requires client

  return (
    <button onClick={() => setCount(c => c + 1)}>  {/* Event handler requires client */}
      Count: {count}
    </button>
  );
}
```

### Hydration Error Prevention

Hydration errors occur when server-rendered HTML doesn't match client-side rendering. Common causes:

**Problem 1: Using browser APIs during render**

```typescript
// ❌ BAD - window not available during SSR
export function BadComponent() {
  const width = window.innerWidth;  // ReferenceError: window is not defined
  return <div>Width: {width}</div>;
}

// ✅ GOOD - Check for browser environment first
'use client';
export function GoodComponent() {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    setWidth(window.innerWidth);  // Safe: runs client-side only
  }, []);

  return <div>Width: {width || 'Loading...'}</div>;
}
```

**Problem 2: Timezone-sensitive dates without SSR compatibility**

```typescript
// ❌ BAD - Date formatting differs between server (UTC) and client (local time)
export function BadTimestamp({ date }: { date: Date }) {
  return <span>{date.toLocaleString()}</span>;  // Hydration mismatch
}

// ✅ GOOD - Use ClientTime component for timezone-aware rendering
import { ClientTime } from '../../../components/ui/ClientTime';

export function GoodTimestamp({ date }: { date: Date }) {
  return <ClientTime date={date} format="PPpp" />;  // Handles SSR correctly
}
```

**See [ui-component-styling.md](./ui/ui-component-styling.md#ssr-hydration-patterns) for complete SSR hydration guidance.**

### Environment Variable Access

Server and client components have different environment variable access:

| Variable Type | Server Components | Client Components |
|---------------|-------------------|-------------------|
| `SITE_BACKEND` | ✅ Available | ❌ Undefined |
| `NEXT_PUBLIC_*` | ✅ Available | ✅ Available |
| Other env vars | ✅ Available | ❌ Undefined |

**Always use centralized config module:**

```typescript
// ✅ GOOD - Works in both server and client contexts
import { config } from '@/lib/config';

export function Component() {
  const apiUrl = config.apiBaseUrl;  // Correct URL for current context
  // ...
}

// ❌ BAD - Breaks in client or server depending on variable
export function Component() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;  // May be undefined
  // ...
}
```

**See [frontend-architecture.md](./frontend-architecture.md#environment-configuration-and-runtime-contexts) for complete config module documentation.**

## Composition Best Practices

### Children vs Render Props vs Component Props

**Use `children` for simple content injection:**

```typescript
function Card({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}

<Card>
  <p>Simple content</p>
</Card>
```

**Use render props when child needs parent data:**

```typescript
function DataFetcher({ render }: { render: (data: Data) => ReactNode }) {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetchData().then(setData);
  }, []);

  return <div>{data ? render(data) : 'Loading...'}</div>;
}

<DataFetcher
  render={(data) => <DataDisplay data={data} />}
/>
```

**Use component props when child needs control from parent:**

```typescript
interface ListProps<T> {
  items: T[];
  renderItem: ComponentType<{ item: T }>;  // Component, not element
  emptyState?: ComponentType;
}

function List<T>({ items, renderItem: Item, emptyState: Empty }: ListProps<T>) {
  if (!items.length && Empty) {
    return <Empty />;
  }

  return (
    <div>
      {items.map((item, i) => <Item key={i} item={item} />)}
    </div>
  );
}

<List
  items={markets}
  renderItem={MarketCard}         // Pass component, not JSX
  emptyState={EmptyMarketsState}
/>
```

### Higher-Order Components vs Hooks

**Prefer hooks over HOCs for logic reuse:**

```typescript
// ❌ OLD - HOC pattern (verbose, nesting issues)
function withAuth(Component) {
  return function AuthenticatedComponent(props) {
    const user = useContext(UserContext);
    if (!user) return <Redirect to="/login" />;
    return <Component {...props} user={user} />;
  };
}

export default withAuth(MyComponent);

// ✅ NEW - Hook pattern (cleaner, composable)
function useAuth() {
  const user = useContext(UserContext);
  if (!user) redirect('/login');
  return user;
}

function MyComponent() {
  const user = useAuth();  // Simple hook call
  return <div>Welcome {user.name}</div>;
}
```

**Use HOCs only for:**

- Cross-cutting concerns that can't be hooks (error boundaries)
- Third-party library integration that requires component wrapping
- Legacy code migration paths

## Pre-Ship Checklist

Before committing any React component or feature, verify:

- [ ] Uses `'use client'` directive if component uses hooks, browser APIs, or interactivity
- [ ] Server components don't use hooks or browser APIs
- [ ] No hydration errors (dates/timezones use ClientTime component)
- [ ] Environment variables accessed through centralized config module
- [ ] Custom hooks follow naming conventions (`use` prefix, camelCase)
- [ ] Hooks include all dependencies in dependency arrays
- [ ] Providers composed in correct order in `app/providers.tsx`
- [ ] Modal/toast APIs used for notifications, not inline state
- [ ] Plugin components receive context via `IFrontendPluginContext` prop
- [ ] Composition patterns used instead of inheritance
- [ ] JSDoc comments explain the "why" before showing the "how"
- [ ] Tested in multiple contexts (full-page, modal, plugin page, mobile)

## Available Component Documentation

**Detailed component guides in `docs/frontend/react/`:**

- [component-icon-picker-modal.md](./react/component-icon-picker-modal.md) - Searchable icon selection modal with visual browsing and real-time search
- [component-scheduler-monitor.md](./react/component-scheduler-monitor.md) - Admin diagnostic tool for monitoring BullMQ scheduled job health with inline controls

**Future component documentation will be added to the `react/` subdirectory following the same pattern.**

## Further Reading

**Detailed documentation:**
- [frontend-architecture.md](./frontend-architecture.md) - File organization, feature modules, environment configuration
- [ui.md](./ui/ui.md) - UI system overview with design tokens and styling standards
- [ui-component-styling.md](./ui/ui-component-styling.md) - CSS Modules, utility classes, accessibility patterns
- [documentation.md](../documentation.md) - Documentation standards and writing style

**React-specific component guides:**
- [react/component-icon-picker-modal.md](./react/component-icon-picker-modal.md) - IconPickerModal component with ModalProvider integration
- [react/component-scheduler-monitor.md](./react/component-scheduler-monitor.md) - SchedulerMonitor component for admin job control

**Related topics:**
- [plugins.md](../plugins/plugins.md) - Plugin architecture overview
- [plugins-frontend-context.md](../plugins/plugins-frontend-context.md) - Plugin context injection and dependency access
- [plugins-page-registration.md](../plugins/plugins-page-registration.md) - Plugin page registration and routing
