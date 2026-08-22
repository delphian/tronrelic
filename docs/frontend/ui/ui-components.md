# UI Component Reference

A complete catalog of TronRelic's standard React components shipped from `components/layout/` and `components/ui/`. Compose these before reaching for raw HTML — they own the design token wiring, accessibility, and SSR behavior the rest of the app depends on.

## Why This Matters

Without a single inventory, developers reinvent primitives (buttons, modals, copy-to-clipboard) inline. Drift follows: inconsistent focus rings, off-palette colors, missing ARIA, forgotten hydration guards. If a component appears here, compose it or extend it in place — don't reimplement.

## How To Use This Catalog

Reach for layout components first, UI primitives next, then SCSS Modules for component-specific customization. Import from the barrel (`'../../../components/layout'`, `'../../../components/ui/<Name>'`) — never deep-import internals. When a primitive almost fits, add the variant rather than fork it. When nothing fits, add a new primitive under `components/ui/<Name>/` with a colocated `.module.scss` and a row in this catalog in the same PR.

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
| `MenuNavSSR` / `MenuNavClient` | SSR-first navigation fed by the backend Menu module; hydrates into a client menu with hamburger support. `MenuNavClient` (submenu mode) is also the **required** renderer for a core/module admin page's in-page tab row — see [Submenu Pattern](../../../src/backend/modules/menu/README.md#submenu-pattern-namespaced-tab-rows) | [MenuNav](../../../src/frontend/components/layout/MenuNav/) |
| `<SubMenu>` | Plugin-facing wrapper over `MenuNavClient`: a menu-namespace-backed in-page tab strip. `onSelect` drives in-page tab state and suppresses navigation; omit it for ordinary nav links. Exposed to plugins as `context.layout.SubMenu` | [SubMenu](../../../src/frontend/components/layout/MenuNav/SubMenu.tsx) |
| `<BlockTicker>` | Compact real-time block ticker; follows SSR + Live Updates with Redux hydration | [BlockTicker](../../../src/frontend/components/layout/BlockTicker/) |

See [ui.md](./ui.md) and [frontend.md](../frontend.md#component-first-layout-architecture) for the decision hierarchy (layout components > utility classes > raw divs).

## UI Primitives

Source: [components/ui/](../../../src/frontend/components/ui/). Each folder exports via its own `index.ts`.

| Component | Purpose | Key Props | Source |
|-----------|---------|-----------|--------|
| `<AccountPicker>` | Searchable Better Auth account selector (by name/email); self-contained — queries the admin account-search endpoint itself. Admin-gated, admin surfaces only | `value` (account id or null), `onChange`, `disabled`, `placeholder` | [AccountPicker](../../../src/frontend/components/ui/AccountPicker/) |
| `<AddressSelector>` | The canonical control for *choosing* a TRON address (as `<TronAddress>` is for rendering one). Accepts a pasted address, or offers a typeahead over tagged addresses matching address or tag text, each shown with its tags. Self-contained; emits validated base58 only. Suggestions are login-gated and degrade to a plain input when absent | `value` (address or null), `onChange`, `disabled`, `placeholder`, `aria-label`, `limit` | [AddressSelector](../../../src/frontend/components/ui/AddressSelector/) |
| `<Badge>` | Inline status/label pill | `tone="neutral\|info\|success\|warning\|danger"`, `showLiveIndicator` | [Badge](../../../src/frontend/components/ui/Badge/) |
| `<Button>` | Primary interactive button with text label | `variant="primary\|secondary\|ghost\|danger\|warning"`, `size="xs\|sm\|md\|lg"`, `icon`, `loading` | [Button](../../../src/frontend/components/ui/Button/) |
| `<Card>` | Content surface with padding, elevation, and tone. Padding never shrinks by breakpoint — pick the step the surface needs | `padding="xs\|sm\|md\|lg"`, `elevated`, `tone`, `noBackgroundImage` | [Card](../../../src/frontend/components/ui/Card/) |
| `<ClientTime>` | Timezone-safe timestamp renderer; SSR-safe placeholder until hydration | `date`, `format="time\|datetime\|date\|relative\|short"`, `fallback` | [ClientTime](../../../src/frontend/components/ui/ClientTime.tsx) |
| `<ConfirmDialog>` | Destructive-action confirmation body mounted inside a `useModal()` modal; danger/ghost button pair with async spinner. The dialog never closes itself — wire `onConfirm`/`onCancel` to `close(modalId)` | `label`, `message`, `confirmLabel`, `cancelLabel`, `onConfirm`, `onCancel` | [ConfirmDialog](../../../src/frontend/components/ui/ConfirmDialog/) |
| `<CopyButton>` | Copy-to-clipboard **button** with `Copy → Check` confirmation and non-secure-context fallback. Use when the affordance carries a visible label; among bare icons use `<TrCopyIcon>` | `value`, `label`, `copiedLabel`, `resetMs`, `ariaLabel` + `ButtonProps` | [CopyButton](../../../src/frontend/components/ui/CopyButton/) |
| `<TrCopyIcon>` | Same copy behaviour on the `<IconButton>` primitive — bare icon, no button chrome. The standard copy affordance in a row of icon actions (address chips, dense tables). First of the `Tr*Icon` family; the prefix avoids lucide-react's `CopyIcon`/`LinkIcon` aliases | `value`, `copiedLabel`, `resetMs`, `aria-label`, `variant`, `size` | [TrCopyIcon](../../../src/frontend/components/ui/TrCopyIcon/) |
| `<Field>` | **The way to attach a label and a validation message to a form control.** Wraps any control — `<Input>`, `<Select>`, `<Textarea>`, or your own — and owns the ARIA wiring: it clones a single element child to add `aria-describedby` pointing at the message, which is the part hand-rolled validation blocks reliably omit, leaving the explanation visible but never announced. `error` takes an array so a value with several faults lists them all and is fixed in one edit; `hint` is standing guidance and is hidden while an error stands, so only one line ever applies. It does **not** restyle the control — set `invalid` on the control itself. Stretches its control to the field width, which overrides `<Select>`'s intrinsic width | `children` (the control, required), `label`, `hint`, `error` (`string \| string[]`), `required`, `htmlFor`, `className` | [Field](../../../src/frontend/components/ui/Field/) |
| `<IconButton>` | Borderless icon-only button for inline row actions (edit, delete, copy in dense tables/headers). Use when `<Button>` chrome would dominate. | `variant="ghost\|primary\|danger\|success"`, `size="xs\|sm\|md\|lg"`, required `aria-label` | [IconButton](../../../src/frontend/components/ui/IconButton/) |
| `<Input>` | Text input with focus ring. `invalid` turns the border and focus ring danger and sets `aria-invalid`, without changing the rendered structure — still a bare `<input>`, so a control that is a flex item stays one. Pair it with `<Field>` to say *why* the value was refused | `variant="default\|ghost"`, `size="xs\|sm\|md\|lg"`, `invalid` + `InputHTMLAttributes` except native `size` | [Input](../../../src/frontend/components/ui/Input/) |
| `<Pagination>` | Page navigation with sibling-count windowing | `total`, `pageSize`, `currentPage`, `siblingCount`, `onPageChange` | [Pagination](../../../src/frontend/components/ui/Pagination/) |
| `<SegmentedControl>` | Compact segmented toggle row for chart and toolbar switches — time window, metric, chart view, data source. Fully controlled and presentational; supplies the `aria-pressed`/`aria-selected` state and arrow-key traversal the hand-rolled `.segmented-control` rows lacked. Per-option `onSelect` covers groups where one segment carries its own side effect | `options` (`{id,label,disabled?,ariaLabel?,title?,controls?,onSelect?}`), `value`, `onChange`, `label` (group aria-label), `variant="group\|tablist"`, `disabled`, `reselect` | [SegmentedControl](../../../src/frontend/components/ui/SegmentedControl/) |
| `<Select>` | Themed native `<select>` with shared input tokens and a Lucide chevron; intrinsic width by default (pass a `width:100%` class to fill) | `variant="default\|ghost"`, `size="xs\|sm\|md\|lg"`, `invalid` + `SelectHTMLAttributes` except native `size` | [Select](../../../src/frontend/components/ui/Select/) |
| `<Skeleton>` | Shimmer placeholder for loading content | All `HTMLDivAttributes` (style for size) | [Skeleton](../../../src/frontend/components/ui/Skeleton/) |
| `<StatTile>` + `<StatGrid>` | One labelled figure — uppercase label, prominent value, optional note — and the auto-fitting grid that lays a row of them out. **Use for every KPI band, summary strip, and "at a glance" readout**; the pattern was rebuilt ~20 times locally before it became a primitive. `size` is density, not a second design (`md` page band, `sm` admin strip); `surface={false}` where tiles share one enclosing card. Values render as passed — format them yourself | Tile: `label`, `value`, `note`, `icon`, `tone="neutral\|primary\|success\|warning\|danger"`, `size="sm\|md"`, `surface`. Grid: `size`, `minColWidth` | [StatTile](../../../src/frontend/components/ui/StatTile/) |
| `<SlideOver>` | Right-anchored portal panel for master-detail review; closes on Escape/backdrop, locks body scroll, manages focus restore. Distinct from `ModalProvider` — declarative and bound to the caller's current selection | `open`, `onClose`, `title`, `label`, `width="md\|lg"` | [SlideOver](../../../src/frontend/components/ui/SlideOver/) |
| `<Switch>` | Icon-rendered on/off toggle for row-level boolean controls (enable flag, tool on/off). Color + icon are state-driven; `role="switch"` + `aria-checked` set automatically. | `on`, `onChange`, `size="xs\|sm\|md\|lg"`, required `aria-label` | [Switch](../../../src/frontend/components/ui/Switch/) |
| `<Table>` + `Thead` / `Tbody` / `Tr` / `Th` / `Td` | Styled table primitives with `variant="default\|compact"`, `stickyHeader` (pins the header, bounds the wrapper to `--table-sticky-max-height`), `isExpanded`, `hasError` row states, `width="auto\|shrink\|expand"` cells, and `numeric` on `Th`/`Td` to right-align a column in tabular figures | | [Table](../../../src/frontend/components/ui/Table/) |
| `<Textarea>` | Themed multiline field matching the Input/Select tokens; `forwardRef` for imperative focus | `variant="default\|ghost"`, `size="xs\|sm\|md\|lg"`, `invalid` + all `TextareaHTMLAttributes` | [Textarea](../../../src/frontend/components/ui/Textarea/) |
| `<Tooltip>` | Hover tooltip with `placement="top\|bottom"` | `content`, `placement` | [Tooltip](../../../src/frontend/components/ui/Tooltip/) |
| `<TronAddress>` | **The canonical way to render a TRON wallet/contract address.** Compact monospace chip — truncated `first 4…last 4`, full value plus any address tags in the tooltip — carrying three slim affordances: copy, a "forward to a public tool" menu, and a Tronscan out-link. Renders synchronously from `address`, so it is SSR-safe; pass a pre-resolved `label` to show a name instead of the truncation (it resolves none itself). Never hand-truncate an address or hand-build a Tronscan anchor | `address`, `label`, `copy`, `tools`, `explorer` (affordances default on), `className` | [TronAddress](../../../src/frontend/components/ui/TronAddress/) |
| `<TronTransactionId>` | **The canonical way to render a transaction id**, as `<TronAddress>` is for an address. Same chip in the same rhythm — truncated `first 8…last 8` monospace, full id in the tooltip, copy and Tronscan out-link — minus the tools menu, since no tool page consumes a transaction id. Renders synchronously from `txId`. Use instead of an icon-only Tronscan anchor: a link labelled by nothing but an out-arrow tells the reader neither which transaction it points at nor that there is an id to copy | `txId`, `copy`, `explorer` (both default on), `className` | [TronTransactionId](../../../src/frontend/components/ui/TronTransactionId/) |
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

For one-off visual treatments, use the utility classes in [globals.scss](../../../src/frontend/app/globals.scss): `.chip`, `.pill`, `.segmented-control` (prefer the `<SegmentedControl>` primitive above — the raw class is for call sites not yet migrated), `.stat-grid`, `.stat-card__label/value/delta`, `.alert`, `.text-muted`, `.text-subtle`, `.link`, `.live-indicator`, `.table-row--flash`. Prefer the React primitives above; these utilities exist for legacy call sites and rare compositional needs. `.btn` and `.badge` are *not* global utilities — they live in `Button.module.scss` and `Badge.module.scss` and are reachable only through `<Button>` / `<Badge>`.

Do not use `.segmented-control` for the in-page tab row on a core or module admin page. Build that row with the menu module's Submenu Pattern instead, meaning `MenuNavClient` backed by a menu namespace, where each tab is a menu node rather than markup written for that one page. See [Submenu Pattern](../../../src/backend/modules/menu/README.md#submenu-pattern-namespaced-tab-rows). The utility remains fine for toggles that do not navigate, such as a chart's range switch.

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
