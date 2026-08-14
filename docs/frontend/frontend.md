# Frontend Overview

TronRelic's frontend is a Next.js 14 application using the App Router. Code is organized by domain module under `src/frontend/modules/`. Every public-facing component is rendered on the server with real data and then takes over live updates in the browser. All styling flows through SCSS Modules backed by a three-layer design token system.

Two terms are worth defining up front, because the rest of this document uses them. **Server-side rendering** (SSR) means the server produces the finished HTML for a page, so the first thing a visitor sees is real content rather than an empty shell. **Hydration** is the step immediately after, where React attaches to that server-rendered HTML in the browser and makes it interactive. If the markup React produces on its first client render does not match what the server sent, hydration fails. That failure is what several of the rules below exist to prevent.

## Why These Patterns Matter

Treat the conventions here as requirements. Rendering on the server first, organizing by module, scoping styles with SCSS Modules, sizing components with container queries, and building layout from React components each exist because the alternative caused a production problem: client-side loading spinners, component files scattered across the tree, global CSS rules colliding, viewport media queries that broke inside modals, slideouts, and plugin widgets, and page structure assembled from `<div>` elements carrying utility classes. Using those approaches again tends to reproduce the same failures.

## Project-Specific Rules

### SSR + Live Updates Is Mandatory

Every public-facing component must render fully on the server with real data, then hydrate to receive live updates. The server component fetches the data and passes it down as a prop. The client component initializes its state from that prop with `useState(initialData)` and attaches its WebSocket subscriptions inside `useEffect`, which runs only after hydration.

Never initialize state as `useState([])` and fetch the data when the component mounts. That breaks hydration, because the server sent HTML containing content while the client's first render produces nothing, and it brings back the loading flash this pattern exists to remove. Loading states are acceptable only for actions the user triggered, for pagination, for search, and for secondary data — never for the main content of a first render. See [react.md](./react/react.md#ssr--live-updates-pattern).

### Code Goes in `modules/`, Not `features/`

New frontend code belongs in `src/frontend/modules/<name>/`, with everything related kept together: `components/`, `hooks/`, `api/`, `lib/`, `types/`, `slice.ts`, and `index.ts`. The older `features/` directory still holds page-specific code written before this convention. Treat it as read-only for the features already there, and do not add new work to it.

Before building anything, list `src/frontend/modules/` and search for an existing component. The modules already cover user identity, menus, address labeling, and scheduler monitoring, among others, and rebuilding something that already exists is a common and expensive mistake. See [frontend-architecture.md](./frontend-architecture.md).

### Layout Uses React Components, Not Utility Classes

Build page structure from the layout components in `components/layout/`. They give you props checked by TypeScript, responsive behaviour handled inside the component, and editor autocomplete. Utility classes provide none of those. Visual styling, meaning surfaces, buttons, and badges, still uses the utility classes (`.surface`, `.btn`, `.badge`) from `globals.scss`. Use components for structure and utility classes for appearance.

| Component | Props | Purpose |
|-----------|-------|---------|
| `<Page>` | — | Page-level grid whose gap adapts to the viewport |
| `<PageHeader>` | `title`, `subtitle` | The page title section |
| `<Stack>` | `gap="sm\|md\|lg"`, `direction="vertical\|horizontal"` | Flex container with a consistent gap |
| `<Grid>` | `gap="sm\|md\|lg"`, `columns="2\|3\|responsive"` | Grid layout |
| `<Section>` | `gap="sm\|md\|lg"` | A content section with standard spacing |

### Admin Page Tab Rows Use the Menu Submenu Pattern

The row of tabs inside a core or module admin page, such as `/system/account-history`, must be built as a menu. A hand-rolled array of `<button>` elements, a `.segmented-control` strip, and a per-page `styles.tab` row are all **not authorized** for this surface. The menu Submenu Pattern is the only permitted approach.

Register each tab as a node in that page's own menu namespace, held in memory rather than the database, with `requiresAdmin` set per node. Fetch that namespace's tree on the server, then render it with `MenuNavClient` in submenu mode, where `onItemSelect` updates `activeTab` and `activeUrl` controls which tab appears selected. Doing it this way inherits per-user visibility rules, ordering, and live refresh through `menu:update` events, and it lets a plugin add a tab of its own. The reference implementation is `/system/account-history`. See [Submenu Pattern](../../src/backend/modules/menu/README.md#submenu-pattern-namespaced-tab-rows).

### Container Queries, Not Viewport Media Queries

Size components against their container using `container-type: inline-size` and `@container` queries, so a component adapts to wherever it is placed — a sidebar, a modal, a full page, a plugin widget, or a slideout. A viewport `@media` query cannot do this, because it only knows the size of the window. Reserve `@media` queries for the global layout in `app/layout.tsx`.

Breakpoint variables such as `$breakpoint-mobile-md` live in `app/breakpoints` and must be written with SCSS interpolation inside a `@container` rule, as `#{$breakpoint-mobile-md}`. See [ui-responsive-design.md](./ui/ui-responsive-design.md).

### Design Tokens and SCSS Modules — No Hardcoded Values

Component styles live in a `Component.module.scss` file beside the component, where class names are scoped automatically. Use underscores in multi-word class names so TypeScript dot notation works, as in `styles.market_card`.

Reference design tokens — the shared CSS custom properties such as `var(--color-primary)`, `var(--gap-md)`, `var(--card-padding-md)`, and `var(--radius-md)` — rather than hardcoding a color, spacing value, font, or size. The rule is simple: **component code references Layer 2 (`semantic-tokens.scss`), and Layer 1 (`primitives.scss`) exists only as input to Layer 2.** Layer 1 holds nothing but `--spacing-N`, `--radius-N`, and the raw font-size scale. Full detail is in [ui-design-token-layers.md](./ui/ui-design-token-layers.md), and the SCSS workflow is in [ui-scss-modules.md](./ui/ui-scss-modules.md).

### Modules Export Through `index.ts`

Every module exposes its public API through an `index.ts` that re-exports the pieces other code is allowed to use. Import from the module root, never from a path inside it.

```typescript
// Good — uses public API
import { WalletButton, useAuthSession } from '../../../modules/user';

// Bad — bypasses public API, couples to internal structure
import { WalletButton } from '../../../modules/user/components/WalletButton/WalletButton';
```

### Providers Compose in One Place

Every provider that cuts across the application — Redux, `ToastProvider`, `ModalProvider`, and `FrontendPluginContextProvider` — is composed in `src/frontend/app/providers.tsx`. Consume them through their hooks (`useToast`, `useModal`, `useDispatch`), and do not introduce a new global provider without adding it to that file.

Order matters, because an outer provider has to be available to the ones inside it: Redux comes first so that every component can reach the store, then the toast and modal providers so that plugins can call their hooks. See [react.md](./react/react.md#provider-composition).

### Never Read `process.env.*` Directly

Server components and `generateMetadata` call `getServerConfig()` from `@/lib/serverConfig`. Client code calls `getRuntimeConfig()` from `@/lib/runtimeConfig`. The old `@/lib/config` module and every `NEXT_PUBLIC_*` variable are deprecated, because Next.js substitutes those values into the bundle at build time, which freezes one domain into what is meant to be a single image deployable anywhere. See [frontend-architecture-runtime-config.md](./frontend-architecture-runtime-config.md).

### Timestamps Render Through `<ClientTime>`

Calling `new Date().toLocaleString()` during render returns UTC on the server, where the container has no user timezone, and local time in the browser. The two disagree, and hydration fails. Use the `<ClientTime>` component for anything timezone-sensitive. See [ui-ssr-hydration.md](./ui/ui-ssr-hydration.md).

## Pre-Ship Checklist

Before committing a UI component or a plugin page:

- [ ] Server component fetches the initial data; the client receives it as a prop and calls `useState(initialData)`, so there is no loading flash on first render
- [ ] Lives in `src/frontend/modules/<name>/` or in a plugin, with its public surface exported through `index.ts` and consumers importing from the module root
- [ ] Page structure uses the layout components (`<Page>`, `<Stack>`, `<Grid>`, `<Section>`) rather than raw `<div>` elements with utility classes
- [ ] Component styles sit in a colocated `.module.scss` file and reference design tokens, with no hardcoded colors, spacing, fonts, or sizes
- [ ] Responsive behaviour uses container queries; viewport `@media` queries appear only in `app/layout.tsx`
- [ ] Icons come from `lucide-react`; icon-only buttons carry an ARIA label; focus states are visible; markup is semantic (`<button>`, `<nav>`, `<ul>`)
- [ ] Timestamps render through `<ClientTime>`, and no `window`, `document`, or `localStorage` access happens in the render body — only inside `useEffect`
- [ ] Backend URLs come from `getServerConfig()` on the server or `getRuntimeConfig()` in the browser, never from `process.env.*` or a `NEXT_PUBLIC_*` variable
- [ ] Admin tab rows use the menu Submenu Pattern with `MenuNavClient` and a menu namespace, not a hand-rolled strip
- [ ] Tested as a full page, in a slideout, in a modal, and at mobile container width

## Further Reading

| Document | Covers |
|----------|--------|
| [frontend-architecture.md](./frontend-architecture.md) | Index linking the architecture documents below |
| [frontend-architecture-modules.md](./frontend-architecture-modules.md) | Choosing between modules and features, module layout, public API barrels, thin route wrappers |
| [frontend-architecture-runtime-config.md](./frontend-architecture-runtime-config.md) | `getServerConfig` versus `getRuntimeConfig`, environment variables, why `NEXT_PUBLIC_*` is forbidden |
| [react.md](./react/react.md) | Implementing SSR + Live Updates, providers, hooks, server versus client components, hydration |
| [ui.md](./ui/ui.md) | Layout components, design tokens, SCSS Modules, container queries |
| [ui-scss-modules.md](./ui/ui-scss-modules.md) | SCSS architecture, naming conventions, the component styling workflow |
| [ui-responsive-design.md](./ui/ui-responsive-design.md) | Container queries, breakpoints, SCSS interpolation pitfalls |
| [ui-design-token-layers.md](./ui/ui-design-token-layers.md) | The token hierarchy, complete reference, theming |
| [ui-icons-and-feedback.md](./ui/ui-icons-and-feedback.md) | Lucide icons, animations, feedback for state changes |
| [ui-accessibility.md](./ui/ui-accessibility.md) | Semantic HTML, ARIA labels, focus management, plugin styling rules |
| [ui-ssr-hydration.md](./ui/ui-ssr-hydration.md) | Preventing hydration errors, `<ClientTime>`, two-phase rendering |
| [ui-theme.md](./ui/ui-theme.md) | The theme system, admin overrides, injection during server rendering |
| [react/component-icon-picker-modal.md](./react/component-icon-picker-modal.md) | `IconPickerModal` and its `ModalProvider` integration |

**Related topics:**

- [plugins.md](../plugins/plugins.md) — the plugin system, which is separate from modules and features
- [plugins-frontend-context.md](../plugins/plugins-frontend-context.md) — what plugins receive: API client, WebSocket client, charts
- [documentation.md](../documentation.md) — documentation standards and writing style
