# Plugin Frontend Context — UI and Layout

`context.layout`, `context.ui`, `context.charts`, `context.system`, and the identity/modal/toast hooks. Source of truth: `packages/types/src/plugin/IFrontendPluginContext.ts`.

## Why Inject Components

Plugins live in `src/plugins/`. Importing from `src/frontend/` crosses the workspace boundary, breaks Next.js module resolution, and couples plugins to app internals. Context injection mirrors the backend `IPluginContext` pattern.

Layout components carry typed props — `<layout.Stack gap="md">` fails compilation if `gap` is wrong; the equivalent `.stack--md` class fails silently.

## Context Shape

```typescript
interface IFrontendPluginContext {
    pluginId: string;              // Used internally for namespacing events and API routes
    layout: ILayoutComponents;     // Page, PageHeader, Stack, Grid, Section
    ui: IUIComponents;             // Card, Badge, Button, IconButton, Switch, Input, Skeleton, ClientTime, Tooltip, IconPickerModal, Table family
    charts: IChartComponents;      // LineChart
    system: ISystemComponents;     // SchedulerMonitor (admin)
    api: IApiClient;               // get/post/put/patch/delete
    websocket: IWebSocketClient;   // socket + auto-prefixed helpers
    useUser: () => IPluginUserState;
    useModal: () => { open, close, closeAll };
    useToast: () => { push, dismiss };
}
```

## Layout (`context.layout`)

Page structure. Use these for all structural markup.

| Component | Props | Purpose |
|-----------|-------|---------|
| `Page` | `children`, `className?` | Page-level grid with responsive gap |
| `PageHeader` | `title: ReactNode`, `subtitle?: ReactNode`, `children?`, `className?` | Page title section (title accepts ReactNode for skeletons) |
| `Stack` | `gap?: 'sm'\|'md'\|'lg'`, `direction?: 'vertical'\|'horizontal'`, `children`, `className?` | Flex container with gap |
| `Grid` | `gap?: 'sm'\|'md'\|'lg'`, `columns?: 2\|3\|'responsive'`, `children`, `className?` | Grid layout |
| `Section` | `gap?: 'sm'\|'md'\|'lg'`, `children`, `className?` | Spaced content section |

## UI (`context.ui`)

| Component | Props |
|-----------|-------|
| `Card` | `tone?: 'default'\|'muted'\|'accent'`, `padding?: 'sm'\|'md'\|'lg'`, `elevated?`, `className?`, `style?`, `children?` |
| `Badge` | `tone?: 'neutral'\|'info'\|'success'\|'warning'\|'danger'`, `title?`, `className?`, `children?` |
| `Skeleton` | `width?`, `height?`, `className?`, `style?` |
| `Button` | `variant?: 'primary'\|'secondary'\|'ghost'\|'danger'\|'warning'`, `size?: 'xs'\|'sm'\|'md'\|'lg'`, `loading?`, `icon?: ReactNode`, `disabled?`, `onClick?`, `type?`, `aria-label?`, `className?`, `children?` |
| `IconButton` | `variant?: 'ghost'\|'primary'\|'danger'\|'success'`, `size?: 'sm'\|'md'\|'lg'`, `onClick?: (event) => void`, `disabled?`, `title?`, `type?`, **`aria-label` (required)**, `className?`, `children?` |
| `Switch` | `on: boolean`, `onChange: (next) => void`, `onClick?: (event) => void`, `size?: 'sm'\|'md'\|'lg'`, `disabled?`, `title?`, `type?`, **`aria-label` (required)**, `className?` |
| `Input` | `value?`, `onChange?`, `onKeyDown?`, `placeholder?`, `disabled?`, `required?`, `variant?: 'default'\|'ghost'`, `type?`, `min?`, `max?`, `step?`, `id?`, `name?`, `aria-label?`, `className?` |
| `ClientTime` | `date: Date \| string \| null \| undefined`, `format?: 'time'\|'datetime'\|'date'`, `fallback?` |
| `Tooltip` | `content: string`, `children: ReactNode`, `placement?: 'top'\|'bottom'` |
| `IconPickerModal` | `selectedIcon?`, `onSelect: (iconName) => void`, `onClose: () => void` |

`IconButton` is for inline row actions where a bordered `Button` would dominate. `aria-label` is required because there's no visible text. The click handler receives the full event so plugin code can call `event.stopPropagation()` to avoid firing an enclosing row's click handler.

`Switch` carries `role="switch"` + `aria-checked` so assistive tech reads it as a toggle. The optional `onClick` runs before `onChange` — calling `event.preventDefault()` vetoes the toggle; `event.stopPropagation()` keeps the click off an enclosing row.

`ClientTime` is the canonical fix for SSR/client timezone hydration mismatches — never call `new Date().toLocaleString()` directly.

### Table Family

Six related components matching the `/system/*` admin tables. Compose them to inherit the same visual treatment plugins see on the system plugins page.

| Component | Props |
|-----------|-------|
| `Table` | `variant?: 'default'\|'compact'`, `className?`, `style?`, `children?` |
| `Thead` | `className?`, `children?` |
| `Tbody` | `className?`, `children?` |
| `Tr` | `hasError?`, `isExpanded?`, `onClick?`, `className?`, `children?` |
| `Th` | `width?: 'auto'\|'shrink'\|'expand'`, `colSpan?`, `rowSpan?`, `className?`, `children?` |
| `Td` | `muted?`, `colSpan?`, `rowSpan?`, `className?`, `children?` |

`Tr.hasError` applies the error surface tone; `Tr.isExpanded` renders the muted "details drawer" background. `Th.width="shrink"` sizes a column to its content (good for status badges/action buttons); `"expand"` forces it to fill remaining space. `Td.muted` dims secondary metadata.

## Charts (`context.charts`)

| Component | Props |
|-----------|-------|
| `LineChart` | `series: { id, label, data: { date, value, max?, count? }[], color?, fill? }[]`, `yAxisFormatter?`, `xAxisFormatter?`, `emptyLabel?`, `height?`, `minDate?`, `maxDate?`, `yAxisMin?`, `yAxisMax?`, `className?` |

`minDate`/`maxDate`/`yAxisMin`/`yAxisMax` are fixed-axis overrides for sparse data — without them the chart auto-scales tightly.

## System (`context.system`) — Admin Only

| Component | Props |
|-----------|-------|
| `SchedulerMonitor` | `token: string`, `jobFilter?: string[] \| (job) => boolean`, `sectionTitle?`, `hideHealth?` |

`SchedulerMonitor` renders job status, enable/disable controls, and schedule edits. `jobFilter` lets a plugin admin page show only its own jobs (e.g., `['markets:refresh']`).

## User State (`context.useUser`)

Reactive identity hook. Avoids Redux coupling and inline freshness recomputation.

```typescript
interface IPluginUserState {
    userId: string | null;
    hasLinkedWallet: boolean;     // wallets.length > 0
    isVerified: boolean;          // identityState === Verified (live session)
    wallets: IPluginWalletLink[];
    primaryWallet: string | null; // most-recent verified wallet, else most-recent unverified
    initialized: boolean;
}

interface IPluginWalletLink {
    address: string;
    verified: boolean;            // historical: true after any past signature
    isPrimary: boolean;
    linkedAt: string;
    lastUsed: string;
    label?: string;
}
```

`isVerified` is the user-level live-session signal — backend `identityState` expires after `SESSION_TTL_MS` (14 days). Per-wallet `verified` is audit history that stays `true` forever. Use `isVerified` for feature gating; use `wallets.some(w => w.verified)` only for the historical claim.

Identity progression: Anonymous (`!hasLinkedWallet`) → Registered (`hasLinkedWallet && !isVerified`) → Verified.

> **Coexistence.** `useUser()` and its `isVerified` / `identityState` / `wallets` fields reflect the *legacy* UUID identity system. It is still live and accurate today, but the frontend plugin auth surface migrates to the Better Auth session in the Phase 6 cutover. Backend plugin routes already gate on `req.authSession` — see [system-auth.md](../system/system-auth.md).

## Modal (`context.useModal`)

```typescript
const { open, close, closeAll } = context.useModal();
```

`open(options)` returns a string id. Hold the id and pass it to `close(id)` — there is no implicit "close the current modal."

`open` options: `title?`, `content: ReactNode` (required), `size?: 'sm'|'md'|'lg'|'xl'`, `dismissible?`, `onClose?`. `closeAll()` clears every open modal — useful on route changes.

## Toast (`context.useToast`)

```typescript
const { push, dismiss } = context.useToast();
```

`push(toast)` returns the toast id; pass to `dismiss(id)` to remove early. Fields: `id?` (auto-generated if omitted), `tone?: 'info'|'success'|'warning'|'danger'`, `title` (required), `description?`, `duration?` (ms), `actionLabel?`, `onAction?`.

## Example — Page With Layout, UI, and Gating

```typescript
import type { IFrontendPluginContext } from '@/types';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui, useUser, useModal, useToast } = context;
    const { isVerified } = useUser();
    const modal = useModal();
    const toast = useToast();

    const handlePremium = () => {
        if (!isVerified) {
            const id = modal.open({
                title: 'Wallet Verification Required',
                size: 'sm',
                content: (
                    <p>
                        Sign with your wallet via the header WalletButton.{' '}
                        <ui.Button variant="ghost" onClick={() => modal.close(id)}>Dismiss</ui.Button>
                    </p>
                )
            });
            return;
        }
        toast.push({ tone: 'success', title: 'Premium activated' });
    };

    return (
        <layout.Page>
            <layout.PageHeader title="My Plugin" />
            <ui.Card>
                <ui.Button onClick={handlePremium}>Premium Feature</ui.Button>
            </ui.Card>
        </layout.Page>
    );
}
```

## Don't

- Import from `apps/frontend` or `src/frontend/` — cross-workspace builds fail.
- Use CSS classes for layout (`.page`, `.stack`, `.grid`) — use `context.layout`.
- Define types by importing from frontend — define inline or in plugin shared types.
- Render timestamps with `new Date().toLocaleString()` — use `ui.ClientTime`.
- Build raw `<table>` markup for admin lists — use the `Table`/`Tr`/`Td` family for visual parity with `/system/*`.

## Further Reading

- [plugins-frontend-context.md](./plugins-frontend-context.md) — index
- [plugins-frontend-context-api.md](./plugins-frontend-context-api.md) — API client
- [plugins-frontend-context-websocket.md](./plugins-frontend-context-websocket.md) — WebSocket subscriptions
- [plugins-frontend-context-styling.md](./plugins-frontend-context-styling.md) — CSS Modules and SSR
- [ui.md](../frontend/ui/ui.md) — design tokens and layout primitives reference
- [ui-ssr-hydration.md](../frontend/ui/ui-ssr-hydration.md) — `ClientTime` semantics
