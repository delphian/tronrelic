# UI Component Reference

A complete catalog of TronRelic's standard React components shipped from `components/layout/` and `components/ui/`. Compose these before reaching for raw HTML — they own the design token wiring, accessibility, and SSR behavior the rest of the app depends on.

## Why This Matters

Without a single inventory, developers reinvent primitives (buttons, modals, copy-to-clipboard) inline, producing drift across pages and plugins. Every duplicate also duplicates its bugs: inconsistent focus rings, off-palette colors, missing ARIA, forgotten hydration guards. This document is the one place to look first. If a component appears here, do not reimplement it — compose it, or extend it in place.

## How To Use This Catalog

Reach for layout components first for page structure, UI primitives next for semantic elements, and SCSS Modules only for component-specific customization on top. Import paths are stable (`'../../../components/layout'` for layout, `'../../../components/ui/<Name>'` for primitives) — do not deep-import internal files. When a primitive almost fits but needs a variant, add the variant to the primitive rather than forking it. When no primitive fits, build a new one inside `components/ui/<Name>/` with a colocated `.module.scss` and add a row to this document in the same PR.

## Layout Primitives

Source: [components/layout/](../../../src/frontend/components/layout/). Export barrel: `index.ts`.

| Component | Purpose | Source |
|-----------|---------|--------|
| `<Page>` | Page-level vertical grid with responsive gap and optional background image | [Page](../../../src/frontend/components/layout/Page/) |
| `<PageHeader>` | Page title + subtitle block with optional actions slot | [PageHeader](../../../src/frontend/components/layout/PageHeader/) |
| `<Stack>` | Flex container; `gap="sm\|md\|lg"`, `direction="vertical\|horizontal"` | [Stack](../../../src/frontend/components/layout/Stack/) |
| `<Grid>` | Grid container; `gap`, `columns="2\|3\|responsive"` | [Grid](../../../src/frontend/components/layout/Grid/) |
| `<Section>` | Content section with internal `gap` spacing | [Section](../../../src/frontend/components/layout/Section/) |
| `<MainHeader>` | Site header: database-driven `MenuNav`, logo, wallet/theme controls (server component) | [MainHeader](../../../src/frontend/components/layout/MainHeader/) |
| `MenuNavSSR` / `MenuNavClient` | SSR-first navigation fed by the backend Menu module; hydrates into a client menu with hamburger support | [MenuNav](../../../src/frontend/components/layout/MenuNav/) |
| `<BlockTicker>` | Compact real-time block ticker; follows SSR + Live Updates with Redux hydration | [BlockTicker](../../../src/frontend/components/layout/BlockTicker/) |

See [ui.md](./ui.md) and [frontend.md](../frontend.md#component-first-layout-architecture) for the decision hierarchy (layout components > utility classes > raw divs).

## UI Primitives

Source: [components/ui/](../../../src/frontend/components/ui/). Each folder exports via its own `index.ts`.

| Component | Purpose | Key Props | Source |
|-----------|---------|-----------|--------|
| `<Badge>` | Inline status/label pill | `tone="neutral\|success\|warning\|danger"`, `showLiveIndicator` | [Badge](../../../src/frontend/components/ui/Badge/) |
| `<Button>` | Primary interactive button | `variant="primary\|secondary\|ghost\|danger"`, `size`, `icon`, `loading` | [Button](../../../src/frontend/components/ui/Button/) |
| `<Card>` | Content surface with padding, elevation, and tone | `padding="sm\|md\|lg"`, `elevated`, `tone`, `noBackgroundImage` | [Card](../../../src/frontend/components/ui/Card/) |
| `<ClientTime>` | Timezone-safe timestamp renderer; SSR-safe placeholder until hydration | `date`, `format="time\|datetime\|date\|relative\|short"`, `fallback` | [ClientTime](../../../src/frontend/components/ui/ClientTime.tsx) |
| `<CopyButton>` | Copy-to-clipboard button with `Copy → Check` confirmation and non-secure-context fallback | `value`, `label`, `copiedLabel`, `resetMs`, `ariaLabel` + `ButtonProps` | [CopyButton](../../../src/frontend/components/ui/CopyButton/) |
| `<Input>` | Text input with focus ring | `variant="default\|ghost"` + all `InputHTMLAttributes` | [Input](../../../src/frontend/components/ui/Input/) |
| `<Pagination>` | Page navigation with sibling-count windowing | `total`, `pageSize`, `currentPage`, `siblingCount`, `onPageChange` | [Pagination](../../../src/frontend/components/ui/Pagination/) |
| `<Skeleton>` | Shimmer placeholder for loading content | All `HTMLDivAttributes` (style for size) | [Skeleton](../../../src/frontend/components/ui/Skeleton/) |
| `<Table>` + `Thead` / `Tbody` / `Tr` / `Th` / `Td` | Styled table primitives with `variant="default\|compact"`, `isExpanded`, `hasError` row states, and `width="auto\|shrink\|expand"` cells | | [Table](../../../src/frontend/components/ui/Table/) |
| `<Tooltip>` | Hover tooltip with `placement="top\|bottom"` | `content`, `placement` | [Tooltip](../../../src/frontend/components/ui/Tooltip/) |
| `<IconPickerModal>` | Searchable Lucide icon picker rendered inside the ModalProvider | `onSelect`, `onClose`, `initialIcon` | [IconPickerModal](../../../src/frontend/components/ui/IconPickerModal/) |

All primitives consume semantic tokens from [semantic-tokens.scss](../../../src/frontend/app/semantic-tokens.scss) and respond to theme changes automatically — see [ui-theme.md](./ui-theme.md).

## Context Providers

Mounted once in [app/providers.tsx](../../../src/frontend/app/providers.tsx); consumed via hooks elsewhere.

| Provider | Purpose | Hook | Source |
|----------|---------|------|--------|
| `ModalProvider` | Portal-based modal stack with size variants, dismissibility, Redux tracking | `useModal()` → `{ open, close }` | [ModalProvider](../../../src/frontend/components/ui/ModalProvider/) |
| `ToastProvider` | Viewport toast queue with variants, auto-dismiss, actions | `useToast()` → `{ push, dismiss }` | [ToastProvider](../../../src/frontend/components/ui/ToastProvider/) |
| `FrontendPluginContextProvider` | Injects `ui`, `layout`, `api`, `charts`, `websocket` into plugin components | via `IFrontendPluginContext` prop | [lib/frontendPluginContext.tsx](../../../src/frontend/lib/frontendPluginContext.tsx) |

See [react.md](../react/react.md#context-provider-system) for composition order and [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) for plugin consumption.

## Error and Utility Components

| Component | Purpose | Source |
|-----------|---------|--------|
| `<ErrorBoundary>` | Catches render errors in a subtree and renders `ErrorFallback` | [ErrorBoundary](../../../src/frontend/components/ui/ErrorBoundary.tsx) |
| `<ErrorFallback>` | Default fallback surface for error states | [ErrorFallback](../../../src/frontend/components/ui/ErrorFallback.tsx) |

## Styling Utility Classes (Not Components)

For one-off visual treatments where a component is overkill, use the utility classes defined in [globals.scss](../../../src/frontend/app/globals.scss): `.surface`, `.btn .btn--primary`, `.badge .badge--success`, `.chip`, `.pill`, `.segmented-control`, `.stat-grid`, `.stat-card__*`, `.alert`, `.text-muted`, `.text-subtle`, `.link`, `.live-indicator`, `.table-row--flash`. Prefer the React components above; utility classes exist for legacy call sites and rare compositional needs.

## When To Add A New Component

Add a new primitive under `components/ui/<Name>/` when the same JSX pattern appears in three or more unrelated places, when the pattern carries non-trivial accessibility or SSR concerns, or when a plugin would otherwise need to duplicate core behavior. Update this document in the same PR that introduces the component. If the new component is plugin-specific, put it in the plugin's own frontend folder instead — this catalog is only for shared primitives.

## Further Reading

**Detailed documentation:**
- [ui.md](./ui.md) — UI system overview and pre-ship checklist
- [ui-scss-modules.md](./ui-scss-modules.md) — SCSS Module architecture and the component-first decision hierarchy
- [ui-design-token-layers.md](./ui-design-token-layers.md) — Tokens consumed by every primitive
- [ui-theme.md](./ui-theme.md) — Themeable components and token overrides

**Related topics:**
- [react.md](../react/react.md) — SSR + Live Updates pattern, provider composition, server vs client components
- [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) — How plugins access these components via `context.ui` / `context.layout`
