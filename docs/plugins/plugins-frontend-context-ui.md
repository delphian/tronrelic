# Plugin Frontend Context — UI and Layout

`context.layout` and `context.ui` for plugin pages and components.

## Why Inject Components

Plugins live in `src/plugins/`. Importing from `src/frontend/` crosses the workspace boundary, breaks Next.js module resolution, and couples plugins to app internals. Context injection mirrors the backend `IPluginContext` pattern.

Layout components carry typed props — `<layout.Stack gap="md">` fails compilation if `gap` is wrong; the equivalent `.stack--md` class fails silently.

## Layout (`context.layout`)

Page structure. Use these for all structural markup.

| Component | Props | Purpose |
|-----------|-------|---------|
| `Page` | `children`, `className?` | Page-level grid with responsive gap |
| `PageHeader` | `title`, `subtitle?`, `children?`, `className?` | Page title section |
| `Stack` | `gap?: 'sm'\|'md'\|'lg'`, `direction?: 'vertical'\|'horizontal'`, `children`, `className?` | Flex container with gap |
| `Grid` | `gap?: 'sm'\|'md'\|'lg'`, `columns?: 2\|3\|'responsive'`, `children`, `className?` | Grid layout |
| `Section` | `gap?: 'sm'\|'md'\|'lg'`, `children`, `className?` | Spaced content section |

## UI (`context.ui`)

Pre-styled primitives.

| Component | Props |
|-----------|-------|
| `Card` | `tone?: 'default'\|'muted'\|'accent'`, `padding?: 'none'\|'sm'\|'md'\|'lg'`, `children?` |
| `Badge` | `tone?: 'default'\|'neutral'\|'success'\|'warning'\|'danger'`, `children?` |
| `Skeleton` | `width?`, `height?` |
| `Button` | `variant?: 'primary'\|'secondary'\|'ghost'`, `onClick?`, `disabled?`, `children?` |
| `Input` | standard input props |

## Charts (`context.charts`)

| Component | Props |
|-----------|-------|
| `LineChart` | `series: { id, label, data: { date, value }[], color? }[]`, `yAxisFormatter?`, `emptyLabel?` |

## User State (`context.useUser`)

Reactive identity hook. Avoids Redux coupling and inline freshness recomputation.

```typescript
interface IPluginUserState {
    userId: string | null;
    hasLinkedWallet: boolean;     // wallets.length > 0
    isVerified: boolean;          // identityState === Verified (live session)
    wallets: IPluginWalletLink[];
    primaryWallet: string | null;
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

## Modal (`context.useModal`)

Hook returning `{ open, close }`. Use for confirmations and gated-feature prompts.

## Example — Page With Layout, UI, and Gating

```typescript
import type { IFrontendPluginContext } from '@/types';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui, useUser, useModal } = context;
    const { isVerified } = useUser();
    const modal = useModal();

    const handlePremium = () => {
        if (!isVerified) {
            modal.open({
                title: 'Wallet Verification Required',
                content: <p>Sign with your wallet via the header WalletButton.</p>,
                size: 'sm'
            });
            return;
        }
        // proceed
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
- Define types by importing from frontend — define inline or in plugin.

## Further Reading

- [plugins-frontend-context.md](./plugins-frontend-context.md) — index
- [plugins-frontend-context-api.md](./plugins-frontend-context-api.md) — API client
- [plugins-frontend-context-websocket.md](./plugins-frontend-context-websocket.md) — WebSocket subscriptions
- [plugins-frontend-context-styling.md](./plugins-frontend-context-styling.md) — CSS Modules and SSR
- [ui.md](../frontend/ui/ui.md) — design tokens and layout primitives reference
