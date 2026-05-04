# Plugin Frontend Context — Styling and SSR

CSS Modules colocated with components, design tokens via `var(--*)`, and the SSR + Live Updates pattern that eliminates loading flash.

## Why CSS Modules for Plugins

Global classes collide across plugins and the core app. CSS Modules scope class names automatically, tree-shake unused styles, and give TypeScript-typed imports. Plugin styles never belong in `globals.scss` — keep them colocated with the component that uses them.

Use design tokens (`var(--color-border)`, `var(--card-padding-md)`) — never hardcoded colors, spacing, or sizes. Use container queries (`@container`), not viewport `@media`, so components adapt inside sidebars, modals, and slideouts.

## Pattern

Create `Component.module.css` (or `.scss`) next to the component:

```css
/* MyPluginPage.module.css */
.dashboard {
    display: grid;
    gap: var(--grid-gap-lg);
    container-type: inline-size;
}

.card {
    padding: var(--card-padding-sm);
    border-radius: var(--radius-md);
    background: var(--color-surface-muted);
}

@container (min-width: 600px) {
    .dashboard { grid-template-columns: repeat(2, 1fr); }
}
```

Import and apply:

```typescript
import styles from './MyPluginPage.module.css';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    return (
        <div className={styles.dashboard}>
            <div className={styles.card}>Card content</div>
        </div>
    );
}
```

Multi-word identifiers use underscores (`styles.market_card`) so dot-notation works. See [ui-scss-modules.md](../frontend/ui/ui-scss-modules.md) for token tiers and naming.

## SSR + Live Updates

Visible plugin UI must render fully on the server with real data, then hydrate for live updates. No loading spinner on initial paint.

`initialData` arrives via the page's `serverDataFetcher` (declared on `IPageConfig`) — the catch-all route awaits it server-side and passes it as a prop. See [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) for the contract, the bazi-fortune reference example, and timezone/serialization pitfalls.

```typescript
'use client';
import { useState, useEffect } from 'react';

interface Props {
    initialData: MyData;
    context: IFrontendPluginContext;
}

export function MyPluginComponent({ initialData, context }: Props) {
    const { layout, ui, websocket } = context;
    const [data, setData] = useState(initialData);  // initialize from SSR

    useEffect(() => {
        const handler = (payload: MyData) => setData(payload);
        websocket.on('update', handler);
        return () => websocket.off('update', handler);
    }, [websocket]);

    return (
        <layout.Page>
            <layout.PageHeader title="My Plugin" />
            <ui.Card>
                {data.items.map(item => <p key={item.id}>{item.title}</p>)}
            </ui.Card>
        </layout.Page>
    );
}
```

Rules:

- `useState(initialData)` — never `useState(null)` with a loading fetch.
- WebSocket subscription in `useEffect` — runs after hydration, never during SSR.
- No spinner on initial render. Spinners are acceptable only for user-triggered actions, pagination, and search.

## Static Imports for SSR

Plugin components must be statically imported (not lazy-loaded) so SSR can resolve them. The build-time generator scans plugin directories and emits static imports. Export from standard locations:

| What | Location |
|------|----------|
| Pages and UI components | `src/frontend/` |
| Widget components | `src/frontend/widgets/index.ts` |

After adding components, regenerate:

```bash
npm run generate:plugins
```

## Migration From Direct Imports

If a legacy plugin imports from `apps/frontend` or `src/frontend/`:

1. Change the component signature to accept `{ context }: { context: IFrontendPluginContext }`.
2. Replace UI imports with `context.ui.*`, `context.layout.*`, `context.charts.*`.
3. Replace API imports with `context.api.get/post/put/delete`.
4. Replace `getSocket()` with `context.websocket.on/subscribe`.
5. Replace inline styles or global classes with a colocated `.module.css` file using design tokens.
6. Replace any frontend type imports with locally-defined interfaces.

## Troubleshooting

**`Module not found: Can't resolve '../../src/frontend/...'`** — Direct cross-workspace import. Replace with context injection.

**`Property 'ui' does not exist on type 'IFrontendPluginContext'`** — Import the type: `import type { IFrontendPluginContext } from '@/types';`.

**Component doesn't receive `context`** — The page must be registered via `definePlugin({ pages: [{ path, component }] })`. Direct exports won't get context wired.

## Further Reading

- [plugins-frontend-context.md](./plugins-frontend-context.md) — index
- [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) — `serverDataFetcher` contract and SEO fields
- [ui-scss-modules.md](../frontend/ui/ui-scss-modules.md) — token tiers, naming, container queries
- [react.md](../frontend/react/react.md) — SSR + Live Updates pattern in depth
