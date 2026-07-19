# Plugin Frontend Context

Plugins receive `IFrontendPluginContext` as a prop on every page and component. It provides UI primitives, layout components, an HTTP client, the shared Socket.IO connection, charts, modal/toast hooks, a reactive user-identity hook, and the file picker — without crossing the `src/plugins/` ↔ `src/frontend/` workspace boundary.

## Why Dependency Injection

Direct imports from `src/frontend/` break Next.js module resolution and couple plugins to app internals — a refactor in core would cascade through every plugin. Context injection mirrors the backend `IPluginContext` pattern: plugins depend on stable interfaces, the host wires implementations.

## Shape

```typescript
interface IFrontendPluginContext {
    pluginId: string;              // namespacing for events and API routes
    layout: ILayoutComponents;     // Page, PageHeader, Stack, Grid, Section, SubMenu
    ui: IUIComponents;             // Card, Badge, Button, CopyButton, IconButton, Switch, Input, Skeleton, ClientTime, Tooltip, IconPickerModal, Table family
    charts: IChartComponents;      // LineChart, BarChart
    system: ISystemComponents;     // SchedulerMonitor (admin)
    api: IApiClient;               // get/post/put/patch/delete with runtime base URL
    websocket: IWebSocketClient;   // socket + auto-prefixed helpers
    useUser: () => IPluginUserState;
    useModal: () => { open, close, closeAll };
    useToast: () => { push, dismiss };
    useFilePicker: () => IFilePickerClient;   // pick/upload files; provider-delivered
    useImageGen: () => IImageGenClient;       // prompt→saved image; provider-delivered
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

## File Picker (`context.useFilePicker`)

`useFilePicker()` is the standardized way to let a user **pick a local file to upload or choose from already-uploaded files**. It returns `{ pick, isAvailable, registerProvider }`. Consumers call `pick(options)` and store the returned selection's `url`/`fileId` — both opaque, never parsed or rebuilt into an endpoint.

```typescript
const { pick, isAvailable } = context.useFilePicker();

const onChoose = async () => {
    const file = await pick({ accept: ['image/*'], title: 'Choose image' });
    if (file) setImageUrl(file.url);   // IFileSelection: { fileId, url, mimeType, name }
};
```

The picker is **core interface, provider-delivered**: core owns `useFilePicker`, but the concrete picker UI is supplied at runtime by whichever files-provider plugin is enabled (`trp-files` by default). That plugin registers its picker via `registerProvider` from its side-effect component, so **last registration wins** — an operator can disable the default provider and enable an alternative, and every consumer picks up the new UI with no code change. `registerProvider` is for provider plugins only; ordinary consumers use `pick`.

Treat files as a **capability that can be absent**: when no provider is enabled, `isAvailable` is `false` and `pick()` resolves to `null`. Hide the "choose file" control when unavailable and offer a fallback (e.g. a URL text field). `isAvailable` is reactive, so the control appears/disappears as the provider plugin is toggled.

> **Deferred: backend files-module facade.** This picker is the *frontend* half only. A core *backend* files-module facade — a stable, always-present server-side handle over the `'files'` service registry — is intentionally **not** built yet. Backend consumers still reach `IFileService` directly via `context.services.watch('files')` (already provider-agnostic). This does not limit the picker: it works and is fully provider-swappable today, because each provider ships both its picker UI and its own endpoints.
>
> **Agents/maintainers: periodically ask the project owner whether it's time to build the backend facade.** What it would add — a single core chokepoint for policy/quota/audit across all backend file writes, and a non-null handle so backend code stops hand-handling "provider not registered." What deferring costs — nothing for the picker; backend consumers keep using `watch('files')`. Surface this every so often (e.g. when adding a new backend file consumer) rather than letting the deferral quietly become permanent.

## Image Generation (`context.useImageGen`)

`useImageGen()` is the "type a prompt, get a saved image back" seam — the exact same shape as the file picker, one capability over. It returns `{ generate, isAvailable, registerProvider }`. `generate({ prompt })` resolves an `IFileSelection` (`fileId`, `url`, `mimeType`, `name`) identical to what `pick()` yields, so a generated image drops into any slot a picked file fills.

```typescript
const { generate, isAvailable } = context.useImageGen();

const onGenerate = async () => {
    const image = await generate({ prompt: 'a neon TRON dashboard, dark theme' });
    if (image) setImageUrl(image.url);   // IFileSelection, already persisted
};
```

Like the picker, this is **core interface, provider-delivered**: core owns `useImageGen`, the enabled image-generation provider plugin registers the concrete generator via `registerProvider` (last registration wins), and `isAvailable` is reactive so a consumer hides its "generate" control when no provider is enabled. `generate` resolves `null` when no provider is registered and rejects when a registered provider fails — surface that reason to the user. The generator persists the image the moment it is produced, so the returned selection is immediately usable; discarding it is a consumer-side UI choice, not an un-save.

**Reference image (image-to-image edit).** Pass an optional `referenceImage` — the same `IFileSelection` the picker or a prior generation yields — to edit or vary an existing image instead of generating from scratch. The prompt then describes the *change*, and the provider runs its edit path. The provider reads only the selection's opaque `fileId`, so the reference must already live in the platform inventory (the picker's upload and browse both satisfy this); no external URL is fetched. A provider whose active generator cannot edit **rejects** the call, so treat the reference control as optional and be ready to surface that rejection — never gate the plain prompt-only path on it.

```typescript
const image = await generate({ prompt: 'make the background deep blue', referenceImage });
```

Providers are provider-neutral by construction — never bind to one vendor's service name. To check whether *any* image provider is reachable, use `isAvailable`, not a probe of a specific plugin.

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
