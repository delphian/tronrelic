# Frontend Overview

TronRelic's frontend is a Next.js 14 App Router application: code organized by domain module under `src/frontend/modules/`, every public-facing component rendered SSR-first with WebSocket live updates after hydration, and styling flowed through SCSS Modules backed by a three-layer design token system.

## Why These Patterns Matter

The conventions below are not preferences. SSR-first rendering, module-based organization, scoped SCSS Modules, container queries, and React layout primitives each exist because their alternatives — client-side loading spinners, scattered component files, global CSS collisions, viewport media queries that fail in modal/slideout/plugin contexts, and `<div>`-with-utility-classes layouts — caused production issues. Deviating from them tends to recreate those failures.

## Project-Specific Rules

### SSR + Live Updates is Mandatory

Every public-facing component must render fully on the server with real data, then hydrate for live updates. Server components fetch data and pass it as a prop; client components initialize `useState(initialData)` from the prop and attach WebSocket subscriptions in `useEffect` after hydration. Never initialize state with `useState([])` and fetch on mount — this breaks hydration (server HTML has content, client first render is empty) and reintroduces the loading flash the pattern exists to eliminate. Loading states are acceptable only for user-triggered actions, pagination, search, and secondary data — never for primary content on initial render. See [react.md](./react/react.md#ssr--live-updates-pattern).

### Code Goes in `modules/`, Not `features/`

New frontend code belongs in `src/frontend/modules/<name>/` with all related code colocated: `components/`, `hooks/`, `api/`, `lib/`, `types/`, `slice.ts`, and `index.ts`. The legacy `features/` directory still holds page-specific code from before this convention; treat it as read-only for existing features and avoid placing new work there. Before adding functionality, list `src/frontend/modules/` and grep for existing components — modules already cover user identity, menu, address labeling, and scheduler monitoring among others, and reimplementing existing capabilities is a common failure mode. See [frontend-architecture.md](./frontend-architecture.md).

### Layout Uses React Components, Not Utility Classes

Page structure is built from layout primitives in `components/layout/`. They provide TypeScript-checked props, encapsulated responsive behavior, and IDE autocomplete that utility classes cannot. Visual styling — surfaces, buttons, badges — uses utility classes (`.surface`, `.btn`, `.badge`) from `globals.scss`. The split: components handle structure, utility classes handle appearance.

| Component | Props | Purpose |
|-----------|-------|---------|
| `<Page>` | — | Page-level grid with responsive gap |
| `<PageHeader>` | `title`, `subtitle` | Page title section |
| `<Stack>` | `gap="sm\|md\|lg"`, `direction="vertical\|horizontal"` | Flex container with gap |
| `<Grid>` | `gap="sm\|md\|lg"`, `columns="2\|3\|responsive"` | Grid layout |
| `<Section>` | `gap="sm\|md\|lg"` | Content section with spacing |

### Admin Page Tab Rows Use the Menu Submenu Pattern

A core or module admin page's in-page tab row (e.g. `/system/account-history`) must be a menu — not a hand-rolled `<button>` array, a `.segmented-control` strip, or a per-page `styles.tab` row. Those are **not authorized** for this surface; the menu Submenu Pattern is the only permitted approach. Register the tabs as nodes in the page's own menu namespace (memory-only, `requiresAdmin` per node), fetch that namespace tree SSR-first, and render it with `MenuNavClient` in submenu mode (`onItemSelect` drives `activeTab`, `activeUrl` highlights). This inherits per-user gating, ordering, and live `menu:update` refresh, and lets a plugin contribute a tab. Reference implementation: `/system/account-history`. See [Submenu Pattern](../../src/backend/modules/menu/README.md#submenu-pattern-namespaced-tab-rows).

### Container Queries, Not Viewport Media Queries

Component responsiveness uses `container-type: inline-size` and `@container` queries so a component adapts to whatever container it lives in (sidebar, modal, full page, plugin widget, slideout). Reserve `@media` queries for global layout in `app/layout.tsx` only. Breakpoint variables (`$breakpoint-mobile-md`, etc.) live in `app/breakpoints` and must be interpolated as `#{$breakpoint-mobile-md}` inside `@container` rules. See [ui-responsive-design.md](./ui/ui-responsive-design.md).

### Design Tokens and SCSS Modules — No Hardcoded Values

Component-specific styles live in colocated `Component.module.scss` files with scoped class names (use underscores for multi-word identifiers so TypeScript dot notation works: `styles.market_card`). Reference design tokens (`var(--color-primary)`, `var(--gap-md)`, `var(--card-padding-md)`, `var(--radius-md)`) — never hardcoded colors, spacing, fonts, or sizes. The token system has three layers: foundation primitives in `primitives.scss` (forbidden in component code — including the `--radius-1`…`--radius-6` scale), use-case-named semantics and curated t-shirt-sized primitives in `semantic-tokens.scss` (preferred), and design-constant primitives like `--shadow-sm` and `--border-width-thin` (acceptable fallback). Full tier rules in [ui-design-token-layers.md](./ui/ui-design-token-layers.md); SCSS workflow in [ui-scss-modules.md](./ui/ui-scss-modules.md).

### Modules Export Through `index.ts`

Every module exposes its public API through a barrel `index.ts`. Consumers import from the module root, never internal paths.

```typescript
// Good — uses public API
import { WalletButton, useAuthSession } from '../../../modules/user';

// Bad — bypasses public API, couples to internal structure
import { WalletButton } from '../../../modules/user/components/WalletButton/WalletButton';
```

### Providers Compose in One Place

All cross-cutting providers (Redux, ToastProvider, ModalProvider, FrontendPluginContextProvider) compose in `src/frontend/app/providers.tsx`. Consume them through hooks (`useToast`, `useModal`, `useDispatch`); do not introduce new global providers without updating that file. Outer providers must be available to inner ones — Redux first so every component can reach the store, then toast/modal so plugins can call their hooks. See [react.md](./react/react.md#provider-composition).

### Environment Variables — Never Read `process.env.*` Directly

Server components and `generateMetadata` call `getServerConfig()` from `@/lib/serverConfig`; client code calls `getRuntimeConfig()` from `@/lib/runtimeConfig`. The legacy `@/lib/config` module and any `NEXT_PUBLIC_*` variables are deprecated — they inline at build time and break the universal Docker image. See [frontend-architecture-runtime-config.md](./frontend-architecture-runtime-config.md).

### Timestamps Render Through `<ClientTime>`

`new Date().toLocaleString()` in render returns UTC on the server (the container) and local time on the client, producing hydration mismatch. Use the `<ClientTime>` component for any timezone-sensitive display. See [ui-ssr-hydration.md](./ui/ui-ssr-hydration.md).

## Pre-Ship Checklist

Before committing a UI component or plugin page:

- [ ] Server component fetches initial data; client receives it as a prop and initializes `useState(initialData)` (no loading flash on initial render)
- [ ] Lives in `src/frontend/modules/<name>/` (or a plugin); public surface exported through `index.ts`; consumers import from module root
- [ ] Page structure uses layout components (`<Page>`, `<Stack>`, `<Grid>`, `<Section>`), not raw `<div>` + utility classes
- [ ] Component styles in colocated `.module.scss`; references design tokens — no hardcoded colors, spacing, fonts, or sizes
- [ ] Responsive behavior uses container queries; viewport `@media` queries reserved for `app/layout.tsx` only
- [ ] Icons from `lucide-react`; ARIA labels on icon-only buttons; visible focus states; semantic HTML (`<button>`, `<nav>`, `<ul>`)
- [ ] Timestamps render via `<ClientTime>`; no `window`/`document`/`localStorage` in render body (only in `useEffect`)
- [ ] Backend URLs read via `getServerConfig()` (SSR) or `getRuntimeConfig()` (client) — never `process.env.*` and never `NEXT_PUBLIC_*`
- [ ] In-page admin tab rows use the menu Submenu Pattern (`MenuNavClient` + a menu namespace), not a hand-rolled strip
- [ ] Tested in multiple contexts (full page, slideout, modal, mobile container width)

## Further Reading

| Document | Covers |
|----------|--------|
| [frontend-architecture.md](./frontend-architecture.md) | Index linking the architecture details below |
| [frontend-architecture-modules.md](./frontend-architecture-modules.md) | Modules vs features decision matrix, module layout, public API barrels, thin route wrappers |
| [frontend-architecture-runtime-config.md](./frontend-architecture-runtime-config.md) | `getServerConfig` vs `getRuntimeConfig`, env vars, why `NEXT_PUBLIC_*` is forbidden |
| [react.md](./react/react.md) | SSR + Live Updates implementation, providers, hooks, server vs client components, hydration |
| [ui.md](./ui/ui.md) | Layout components, design tokens, SCSS Modules, container queries — UI system overview |
| [ui-scss-modules.md](./ui/ui-scss-modules.md) | SCSS architecture, naming conventions, component styling workflow |
| [ui-responsive-design.md](./ui/ui-responsive-design.md) | Container queries, breakpoints, SCSS interpolation gotchas |
| [ui-design-token-layers.md](./ui/ui-design-token-layers.md) | Token hierarchy, complete reference, theming |
| [ui-icons-and-feedback.md](./ui/ui-icons-and-feedback.md) | Lucide icons, animations, state feedback |
| [ui-accessibility.md](./ui/ui-accessibility.md) | Semantic HTML, ARIA labels, focus management, plugin styling rules |
| [ui-ssr-hydration.md](./ui/ui-ssr-hydration.md) | Hydration error prevention, `<ClientTime>`, two-phase rendering |
| [ui-theme.md](./ui/ui-theme.md) | Theme system, admin overrides, SSR injection |
| [react/component-icon-picker-modal.md](./react/component-icon-picker-modal.md) | IconPickerModal + ModalProvider integration |

**Related topics:**

- [plugins.md](../plugins/plugins.md) — Plugin architecture (separate from modules and features)
- [plugins-frontend-context.md](../plugins/plugins-frontend-context.md) — Plugin frontend DI: API client, WebSocket, charts
- [documentation.md](../documentation.md) — Documentation standards and writing style
