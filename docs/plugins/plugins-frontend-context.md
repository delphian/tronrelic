# Plugin Frontend Context

Plugins receive `IFrontendPluginContext` as a prop on every page and component. It provides UI primitives, layout components, an HTTP client, the shared Socket.IO connection, charts, modal/toast hooks, and a reactive user-identity hook — without crossing the `src/plugins/` ↔ `src/frontend/` workspace boundary.

## Why Dependency Injection

Direct imports from `src/frontend/` break Next.js module resolution and couple plugins to app internals — a refactor in core would cascade through every plugin. Context injection mirrors the backend `IPluginContext` pattern: plugins depend on stable interfaces, the host wires implementations.

## Shape

```typescript
interface IFrontendPluginContext {
    pluginId: string;              // namespacing for events and API routes
    layout: ILayoutComponents;     // Page, PageHeader, Stack, Grid, Section, SubMenu
    ui: IUIComponents;             // Card, Badge, Button, IconButton, Switch, Input, Skeleton, ClientTime, Tooltip, IconPickerModal, Table family
    charts: IChartComponents;      // LineChart, BarChart
    system: ISystemComponents;     // SchedulerMonitor (admin)
    api: IApiClient;               // get/post/put/patch/delete with runtime base URL
    websocket: IWebSocketClient;   // socket + auto-prefixed helpers
    useUser: () => IPluginUserState;
    useModal: () => { open, close, closeAll };
    useToast: () => { push, dismiss };
}
```

Plugin pages destructure what they need:

```typescript
import type { IFrontendPluginContext } from '@/types';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui, api } = context;
    // ...
}
```

The `definePlugin({ pages: [{ path, component }] })` registration wires `context` automatically — direct exports won't receive it.

## Detail Documents

| Document | Covers |
|----------|--------|
| [plugins-frontend-context-ui.md](./plugins-frontend-context-ui.md) | Layout primitives, UI components, charts, `useUser` identity gating, `useModal` |
| [plugins-frontend-context-api.md](./plugins-frontend-context-api.md) | `context.api` HTTP client, plugin-scoped paths, admin gating, runtime base URL |
| [plugins-frontend-context-websocket.md](./plugins-frontend-context-websocket.md) | `context.websocket` helpers, auto-prefixed events and rooms, reliable subscription pattern |
| [plugins-frontend-context-styling.md](./plugins-frontend-context-styling.md) | CSS Modules colocation, design tokens, SSR + Live Updates, static imports |

## Don't

- Import from `apps/frontend` or `src/frontend/` — cross-workspace builds fail.
- Read `process.env.*` or `NEXT_PUBLIC_*` — breaks the universal Docker image.
- Add plugin styles to `globals.scss` — colocate as `.module.css` with the component.
- Use viewport `@media` queries inside plugins — use `@container`.
- Manage your own Socket.IO connection or API client — use the injected ones.

## Further Reading

- [plugins.md](./plugins.md) — plugin system overview
- [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) — `serverDataFetcher` for SSR initial data
- [plugins-page-registration.md](./plugins-page-registration.md) — how pages are registered and routed
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) — backend room registration and validation
- [ui.md](../frontend/ui/ui.md) — design tokens, layout primitives, accessibility
