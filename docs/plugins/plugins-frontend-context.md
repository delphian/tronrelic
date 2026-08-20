# Plugin Frontend Context

Plugins receive `IFrontendPluginContext` as a prop on every page and component. It provides UI primitives, layout components, an HTTP client, the shared Socket.IO connection, charts, modal/toast hooks, a reactive user-identity hook, and the file picker — without crossing the `src/plugins/` ↔ `src/frontend/` workspace boundary.

## Why Dependency Injection

Direct imports from `src/frontend/` break Next.js module resolution and couple plugins to app internals — a refactor in core would cascade through every plugin. Context injection mirrors the backend `IPluginContext` pattern: plugins depend on stable interfaces, the host wires implementations.

## Shape

```typescript
interface IFrontendPluginContext {
    pluginId: string;              // namespacing for events and API routes
    layout: ILayoutComponents;     // Page, PageHeader, Stack, Grid, Section, SubMenu
    ui: IUIComponents;             // Card, Badge, Button, CopyButton, IconButton, Switch, Input, Select, Textarea, Skeleton, StatTile, StatGrid, ClientTime, Tooltip, TronAddress, TronTransactionId, IconPickerModal, ConfirmDialog, AccountPicker, AddressSelector, Table family
    charts: IChartComponents;      // LineChart, BarChart
    system: ISystemComponents;     // SchedulerMonitor, CollectionBrowser, ClickHouseTableBrowser (admin)
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

## Admin Surfaces (`context.system`)

Three core admin components are republished to plugins so a plugin's own admin
page can offer Schedules and Database tabs without sending the operator back to
`/system`. Import them from the context — never by relative path across the
workspace.

| Component | Purpose | Scoping |
|---|---|---|
| `SchedulerMonitor` | Job status, enable/disable, cron editing | `jobFilter` — names or a predicate |
| `CollectionBrowser` | MongoDB collections, documents, edit, delete | `prefix`, e.g. `plugin_<id>_` |
| `ClickHouseTableBrowser` | ClickHouse tables and rows (read-only) | `pluginId` — your `manifest.id` |

Both browsers filter **server-side**, so a scoped page never receives the rest
of the deployment's inventory. `CollectionBrowser` takes `allowEdit` and
`allowDelete` (default true) — turn them off where your plugin maintains
invariants across collections that a raw write would break, and point operators
at your own admin actions instead. `ClickHouseTableBrowser` has no write
counterpart by design, and accepts `hideWhenEmpty` so a plugin with no
ClickHouse tables renders nothing rather than an empty panel.

Both stores put a plugin's data in the same namespace, `plugin_<id>_`, with
your identifier embedded exactly as the manifest declares it. Plugin
`my-plugin` stores its documents under `plugin_my-plugin_` and its ClickHouse
tables under `plugin_my-plugin_` as well. `ClickHouseTableBrowser` takes
`pluginId` and derives that prefix itself, which is preferable to its
deprecated `prefix` prop because a hand-written string drifts when an
identifier changes, and the mistake shows up as a browser listing nothing
rather than as an error.

`CollectionBrowser` pages documents by cursor rather than by page number, which
is why it offers First and Last on any collection regardless of size. An offset
jump charges the server for every document it skips, so on a collection of tens
of millions of documents reaching the far end would stall MongoDB for a screen
of rows; each cursor page is instead a bounded range on the `_id` index and
costs the same wherever it sits. Two consequences worth knowing when you embed
it: documents are always ordered by `_id` descending, since a keyset boundary
needs a field that is unique and indexed on every collection; and the page count
comes from `estimatedDocumentCount()`, so on a collection taking live writes it
is close rather than exact. Whatever your collection keys on works — the page
cursors carry the `_id`'s BSON type along with its value, so a plugin collection
keyed on a number, a UUID, or a date pages the same as an ObjectId one.

```tsx
const { system } = context;

<system.SchedulerMonitor jobFilter={(job) => job.name.startsWith('my-plugin:')} hideStats />
<system.CollectionBrowser prefix="plugin_my-plugin_" allowDelete={false} />
<system.ClickHouseTableBrowser pluginId="my-plugin" hideWhenEmpty />
```

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

**Reference images (edit and compose).** Pass an optional `referenceImages` array — the same `IFileSelection` objects the picker or a prior generation yields — to work from existing images. How many you pass selects the operation, because "revise this picture" and "build a new picture out of these" are different requests: none generates from the prompt alone, **one** edits that image (the prompt describes the *change*), and **two or more** compose a new image the prompt refers to positionally.

Order is meaningful and preserved, so "the jacket from the second image" lines up with what the provider receives — pass them in the order the prompt names them, and show the user which is which. Providers read only each selection's opaque `fileId`, so every reference must already live in the platform inventory (the picker's upload and browse both satisfy this); no external URL is fetched. Providers cap how many references they accept and **reject** an over-limit call, as does one whose generator cannot edit or compose at all — so keep the reference control optional, surface that rejection, and never gate the prompt-only path on it. Every element must be a real selection: if your control holds fixed slots that can be empty, drop the empty ones before calling — core's runtime filter is a safety net for untyped callers, not part of the contract. The singular `referenceImage` still works but is **deprecated**: core normalizes it into the array before any provider sees it (a non-empty `referenceImages` wins when both are set), so **write new providers to read the plural field only**. Core also mirrors a lone reference back onto the singular field, so a provider pinned to a types release predating `referenceImages` keeps serving the edit path instead of silently ignoring the reference.

Composition is **opt-in**: a provider declares `supportsComposition: true` at registration to say it reads `referenceImages`, and core rejects any two-or-more-reference call to a provider that has not. Omitting the flag means no, which is what makes the gate safe by default — a provider predating the array reads only the singular field, which core clears at two or more references, so without the gate a compose request would reach it as a bare prompt and persist an unrelated image instead of failing. The flag is a capability, not a limit: a composing provider still enforces its own numeric ceiling and rejects over-limit calls with a message naming it, because that cap is model-dependent and cannot be stated once at registration.

```typescript
// Two entries → compose; pass a single entry instead to edit that one image
const composed = await generate({ prompt: 'the watch from image 1 on the wrist in image 2', referenceImages: [watch, model] });
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
