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
| `<Page>` | Page-level vertical grid with responsive gap and optional background image. Its one column is `minmax(0, 1fr)`, so a child that cannot shrink overflows inside itself instead of widening the page | [Page](../../../src/frontend/components/layout/Page/) |
| `<PageHeader>` | Page title + subtitle block with optional actions slot. On a compact admin page the title takes one smaller heading and the subtitle secondary body text | [PageHeader](../../../src/frontend/components/layout/PageHeader/) |
| `<AdminPage>` | **The shell for every admin page**: a `<Page>` holding the `<PageHeader>` and then the children (the tab row and the active panel), one stack gap apart. Placing those parts directly in `<Page>` spaces them by the page gap, which left some admin pages 36px between the header and its own tabs and others 12px. Props `title`, `subtitle`, `actions` (beside the title), `children`. Exposed to plugins as `context.layout.AdminPage` | [AdminPage](../../../src/frontend/components/layout/AdminPage/) |
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
| `<AddressSelector>` | The canonical control for *choosing* a TRON address (as `<TronAddress>` is for rendering one). Accepts a pasted address, or offers a typeahead over tagged addresses matching address or tag text, each shown with its tags. Self-contained; emits validated base58 only. Suggestions are login-gated and degrade to a plain input when absent | `value` (address or null), `onChange`, `disabled`, `placeholder`, `aria-label`, `limit`, `id`, `aria-describedby`, `aria-required`. The last three are forwarded to whichever control the current state renders, so `<Field label="…">` can label it like any other control | [AddressSelector](../../../src/frontend/components/ui/AddressSelector/) |
| `<Badge>` | Inline status/label pill, sized to its label on one line and wrapping only when its container is narrower than the label. `size` steps the padding around the label and nothing else — the badge's type already sits at the design system's 0.72rem floor, so a dense list gets a tighter pill rather than smaller words. Reach for `sm` or below in a narrow rail, a sidebar, or a table cell, where the default pill takes more width than the label earns | `tone="neutral\|info\|success\|warning\|danger"`, `size="xs\|sm\|md\|lg"`, `showLiveIndicator` | [Badge](../../../src/frontend/components/ui/Badge/) |
| `<Button>` | Primary interactive button with text label, which never wraps. With no `size` it takes the default step of the page's density: `md` normally, `sm` on a compact admin page | `variant="primary\|secondary\|ghost\|danger\|warning"`, `size="xs\|sm\|md\|lg"`, `icon`, `loading` | [Button](../../../src/frontend/components/ui/Button/) |
| `<Card>` | Content surface with padding, elevation, and tone. Padding never shrinks by breakpoint — pick the step the surface needs | `padding="xs\|sm\|md\|lg"`, `elevated`, `tone`, `noBackgroundImage` | [Card](../../../src/frontend/components/ui/Card/) |
| `<ClientTime>` | Timezone-safe timestamp renderer; SSR-safe placeholder until hydration | `date`, `format="time\|datetime\|date\|relative\|short"`, `fallback` | [ClientTime](../../../src/frontend/components/ui/ClientTime.tsx) |
| `<ConfirmDialog>` | Destructive-action confirmation body mounted inside a `useModal()` modal; danger/ghost button pair with async spinner. The dialog never closes itself — wire `onConfirm`/`onCancel` to `close(modalId)` | `label`, `message`, `confirmLabel`, `cancelLabel`, `onConfirm`, `onCancel` | [ConfirmDialog](../../../src/frontend/components/ui/ConfirmDialog/) |
| `<CopyButton>` | Copy-to-clipboard **button** with `Copy → Check` confirmation and non-secure-context fallback. Use when the affordance carries a visible label; among bare icons use `<TrCopyIcon>` | `value`, `label`, `copiedLabel`, `resetMs`, `ariaLabel` + `ButtonProps` | [CopyButton](../../../src/frontend/components/ui/CopyButton/) |
| `<FigureList>` | Many figures as statement-style label-and-value rows: label left, value right-aligned in tabular figures, muted unit, optional note under the label, a hairline between rows. A value too wide for its row wraps instead of covering the label. Flows into as many columns as fit. **Use it for a section with many figures**; keep `<StatTile>` for a short headline band. See [component-figure-list.md](../react/component-figure-list.md) | `rows` (`IFigureListRow[]`: `key`, `label`, `value`, `unit?`, `note?`, `tone?`), `label`, `columns="auto\|single"` | [FigureList](../../../src/frontend/components/ui/FigureList/) |
| `<SiteLink>` | A link to another page of the site that navigates without a full page load, published to plugins as `context.ui.Link`. Renders a plain `<a>` for a link that leaves the site or changes language (`canNavigateInPage`), since a language change needs a full page load. Prefetch is off unless set. Pass an href already localized with `useLocalizedHref()` | `href`, `prefetch`, anchor attributes | [SiteLink](../../../src/frontend/components/ui/SiteLink/) |
| `<Panel>` | One titled section of a data page as a single card: a header row with the title, a muted `meta` line shared by the whole section, and `actions`, then the content with no second box inside. Declares a size container named `panel`. Use instead of a `<Card>` plus a hand-built heading row. See [component-panel.md](../react/component-panel.md) | `title`, `titleAs="h2\|h3\|h4"`, `meta`, `actions`, `tone="default\|muted"`, `id` | [Panel](../../../src/frontend/components/ui/Panel/) |
| `<PriceRail>` | Listed values as ticks on one horizontal scale with the cheapest-to-dearest span shaded, and observed values as toned markers on the same scale. Unit-agnostic; drops tick labels that would overlap. Published to plugins on `context.charts`. See [component-price-rail.md](../react/component-price-rail.md) | `ticks`, `markers`, `formatValue`, `bandLabel`, `unit`, `label` | [PriceRail](../../../src/frontend/components/ui/PriceRail/) |
| `<TrCopyIcon>` | Same copy behaviour on the `<IconButton>` primitive — bare icon, no button chrome. The standard copy affordance in a row of icon actions (address chips, dense tables). First of the `Tr*Icon` family; the prefix avoids lucide-react's `CopyIcon`/`LinkIcon` aliases | `value`, `copiedLabel`, `resetMs`, `aria-label`, `variant`, `size` | [TrCopyIcon](../../../src/frontend/components/ui/TrCopyIcon/) |
| `<Field>` | **The way to attach a label and a validation message to a form control.** Wraps any control — `<Input>`, `<Select>`, `<Textarea>`, or your own — and owns the ARIA wiring: it clones a single element child to add `aria-describedby` pointing at the message, which is the part hand-rolled validation blocks reliably omit, leaving the explanation visible but never announced. `error` takes an array so a value with several faults lists them all and is fixed in one edit; `hint` is standing guidance and is hidden while an error stands, so only one line ever applies. It does **not** restyle the control — set `invalid` on the control itself. Stretches its control to the field width, which overrides `<Select>`'s intrinsic width. **Wrap a `<Switch>` in `<Field inline>`**, which puts the label and the switch on one row with the switch at its own width and the hint underneath; stacked, the switch becomes a wide button on its own line far from its label | `children` (the control, required), `label`, `hint`, `error` (`string \| string[]`), `required`, `inline`, `htmlFor`, `className` | [Field](../../../src/frontend/components/ui/Field/) |
| `<IconButton>` | Borderless icon-only button for inline row actions (edit, delete, copy in dense tables/headers). Use when `<Button>` chrome would dominate. | `variant="ghost\|primary\|danger\|success"`, `size="xs\|sm\|md\|lg"`, required `aria-label` | [IconButton](../../../src/frontend/components/ui/IconButton/) |
| `<Input>` | Text input with focus ring. `size` moves padding *and* type together, on a ladder `<Select>` and `<Textarea>` share, so a dense control reads as one step down rather than as a full-size field squeezed into less room; the `xs` step holds its type at the 0.72rem legibility floor. `invalid` turns the border and focus ring danger and sets `aria-invalid`, without changing the rendered structure — still a bare `<input>`, so a control that is a flex item stays one. Pair it with `<Field>` to say *why* the value was refused | `variant="default\|ghost"`, `size="xs\|sm\|md\|lg"`, `invalid` + `InputHTMLAttributes` except native `size` | [Input](../../../src/frontend/components/ui/Input/) |
| `<Pagination>` | Page navigation with sibling-count windowing. The page buttons are 34px at every density. On a public page they sit in a muted, bordered bar; under the compact density of an admin page the bar has no frame, so it is no taller than the controls beside it in a table footer. The `--pagination-*` tokens select this, so there is no prop for it. Exposed to plugins as `context.ui.Pagination`, with its props declared as `IPaginationProps` | `total`, `pageSize`, `currentPage`, `siblingCount`, `onPageChange` | [Pagination](../../../src/frontend/components/ui/Pagination/) |
| `<SegmentedControl>` | Compact segmented toggle row for chart and toolbar switches — time window, metric, chart view, data source. Fully controlled and presentational; supplies the `aria-pressed`/`aria-selected` state and arrow-key traversal the hand-rolled `.segmented-control` rows lacked. Per-option `onSelect` covers groups where one segment carries its own side effect. Hugs its segments instead of stretching to its parent, and wraps them onto a second line rather than widening a narrow host | `options` (`{id,label,disabled?,ariaLabel?,title?,controls?,onSelect?}`), `value`, `onChange`, `label` (group aria-label), `variant="group\|tablist"`, `disabled`, `reselect` | [SegmentedControl](../../../src/frontend/components/ui/SegmentedControl/) |
| `<Select>` | Themed native `<select>` with shared input tokens and a Lucide chevron, the same height as an `<Input>` of the same size; intrinsic width by default (pass a `width:100%` class to fill). Reports its widest option as its narrowest width, so a `width="shrink"` table column fits the value instead of cutting it off | `variant="default\|ghost"`, `size="xs\|sm\|md\|lg"`, `invalid` + `SelectHTMLAttributes` except native `size` | [Select](../../../src/frontend/components/ui/Select/) |
| `<Skeleton>` | Shimmer placeholder for loading content | All `HTMLDivAttributes` (style for size) | [Skeleton](../../../src/frontend/components/ui/Skeleton/) |
| `<StatTile>` + `<StatGrid>` | One labelled figure — uppercase label, prominent value, optional note — and the auto-fitting grid that lays a row of them out. **Use for every KPI band, summary strip, and "at a glance" readout**; the pattern was rebuilt ~20 times locally before it became a primitive. `size` is density, not a second design (`md` page band, `sm` admin strip); `surface={false}` where tiles share one enclosing card. Values render as passed — format them yourself. A label with no spaces, such as a path, breaks inside its tile rather than running into the next | Tile: `label`, `value`, `note`, `icon`, `tone="neutral\|primary\|success\|warning\|danger"`, `size="sm\|md"`, `surface`. Grid: `size`, `minColWidth` | [StatTile](../../../src/frontend/components/ui/StatTile/) |
| `<SlideOver>` | Right-anchored portal panel for master-detail review; closes on Escape/backdrop, locks body scroll, manages focus restore. Distinct from `ModalProvider` — declarative and bound to the caller's current selection | `open`, `onClose`, `title`, `label`, `width="md\|lg"` | [SlideOver](../../../src/frontend/components/ui/SlideOver/) |
| `<Switch>` | Icon-rendered on/off toggle for row-level boolean controls (enable flag, tool on/off). Color + icon are state-driven; `role="switch"` + `aria-checked` set automatically. `label` draws visible text beside the icon inside the button, so the words never wrap away from the switch and clicking them flips it. A switch needs `label` or `aria-label`, and the type requires one | `on`, `onChange`, `size="xs\|sm\|md\|lg"`, `label`, `aria-label` (required without `label`) | [Switch](../../../src/frontend/components/ui/Switch/) |
| `<Table>` + `Thead` / `Tbody` / `Tr` / `Th` / `Td` | Styled table primitives with `variant="default\|compact"`, `stickyHeader` (pins the header in a scroll box bounded to `--table-sticky-max-height`, released while rows are stacked), `flush` (**set it whenever the table is the last thing in a `<Card>` and fills the card's width** — see below), `isExpanded`, `hasError` row states, an `onClick` row that also answers the keyboard (see below), `width="auto\|shrink\|expand"` on `Th`, where `shrink` keeps the column's cells on one line, `numeric` on `Th`/`Td` to right-align a column in tabular figures, and `stackAt="tablet\|mobile\|phone"` with `label` on each `Td` to turn rows into labelled entries on narrow screens, plus `stackSpan` on a `Td` whose value is long (**set it on any table that does not fit a phone** — see below) | | [Table](../../../src/frontend/components/ui/Table/) |
| `<Textarea>` | Themed multiline field matching the Input/Select tokens; `forwardRef` for imperative focus | `variant="default\|ghost"`, `size="xs\|sm\|md\|lg"`, `invalid` + all `TextareaHTMLAttributes` | [Textarea](../../../src/frontend/components/ui/Textarea/) |
| `<Tooltip>` | Hover tooltip with `placement="top\|bottom"` | `content`, `placement` | [Tooltip](../../../src/frontend/components/ui/Tooltip/) |
| `<TronAddress>` | **The canonical way to render a TRON wallet address.** Compact monospace chip — truncated `first 4…last 4`, full value plus any address tags in the tooltip — followed by one wrench icon, always shown. Its menu copies the address, opens it on Tronscan, forwards it to a public tool page, and, for admins, edits its tags. There is no prop to hide the wrench or any entry, so an address offers the same actions everywhere. Renders synchronously from `address`, so it is SSR-safe; pass a pre-resolved `label` to show a name instead of the truncation (it resolves none itself). Never hand-truncate an address or hand-build a Tronscan anchor. For a smart contract use `<TronContractAddress>` | `address`, `label`, `className` | [TronAddress](../../../src/frontend/components/ui/TronAddress/) |
| `<TronContractAddress>` | **The canonical way to render a smart contract address**, as `<TronAddress>` is for a wallet. The same chip with the same props — tags, warning marker, and the one wrench whose menu copies the address and holds the tag editor for admins — but the menu's Tronscan entry opens the contract page, and the menu offers only tool pages that accept a contract (today the Address Converter). Wallet-only tools such as the Signature Verifier and Address Origins are left out because they come back empty for a contract. Use it for token contracts, DEX routers, and any observer's `contract_address` | `address`, `label` (e.g. a token symbol), `className` | [TronContractAddress](../../../src/frontend/components/ui/TronContractAddress/) |
| `<TronTransactionId>` | **The canonical way to render a transaction id**, as `<TronAddress>` is for an address. Same chip in the same rhythm — truncated `first 6…last 6` monospace, full id in the tooltip, then the same always-shown wrench. Its menu copies the id and opens it on Tronscan, with no tool entries, since no tool page consumes a transaction id. There is no prop to hide the wrench or an entry. Renders synchronously from `txId`. Use instead of an icon-only Tronscan anchor: a link labelled by nothing but an out-arrow tells the reader neither which transaction it points at nor that there is an id to copy | `txId`, `className` | [TronTransactionId](../../../src/frontend/components/ui/TronTransactionId/) |
| `<IconPickerModal>` | Searchable Lucide icon picker rendered inside the ModalProvider | `onSelect`, `onClose`, `initialIcon` | [IconPickerModal](../../../src/frontend/components/ui/IconPickerModal/) |

All primitives consume semantic tokens from [semantic-tokens.scss](../../../src/frontend/app/semantic-tokens.scss) and respond to theme changes automatically — see [ui-theme.md](./ui-theme.md).

### A Table Inside a Card Runs to the Card's Edges

When a `<Table>` fills the width of the `<Card>` holding it and is the last thing in that card, pass `flush`. Without it the table sits inside the card's padding and draws a border of its own, which puts two boundaries a few pixels apart and reads as a seam. The doubled gutter also costs width the columns need, and that shows up first on a narrow screen, where it decides whether a column fits or scrolls.

`flush` cancels the card's padding on the left, right, and bottom, drops the table's own border and background, squares the top corners, and rounds the bottom pair to the card's corner. A heading above the table keeps its normal inset, so the card still reads as a titled panel with a full-width table under it. When the table is also the first thing in the card, with its heading outside the card, `flush` cancels the top padding as well and rounds all four corners, so the header row sits on the card's top edge instead of below an empty band.

```tsx
<Card padding="sm">
    <Stack gap="sm">
        <h2>Latest transfers</h2>
        <Table variant="compact" flush>…</Table>
    </Stack>
</Card>
```

The table reads the gutter to cancel from `--card-padding-applied`, which each `<Card>` padding variant publishes, so changing the card's `padding` keeps the two aligned. Leave `flush` off when anything follows the table inside the same card, because the variant pulls itself down onto the card's bottom edge.

### A Wide Table Stacks on a Narrow Screen

A table with more columns than a phone can show either scrolls sideways, which hides columns off-screen, or squeezes its widest column to a few characters. Pass `stackAt` instead. When the table's own container is at or below the chosen width, `tablet` (1024px) or `mobile` (768px), the header row is hidden and each row becomes an entry in which every value is shown with its column name. The width is measured against the table's container rather than the window, so a table in a slide-over or modal stacks for the space it really has.

An entry uses the width it has. Its labelled values sit side by side in equal columns, as many as fit at 160px each, with the column name above the value: two columns from 481px, three from 528px, four from 688px, five from 848px. At 480px and below there is room for one column, so each value takes a line with its name to the left, in a column `--table-stack-label-width` wide: 8.5rem normally and 6rem under the compact density of an admin page, where a label longer than that wraps to a second line. Giving every value its own line at every width left most of a tablet's width empty and made a five-value entry six lines tall, so do not reintroduce it. Two values do not share a line at phone width either, because sharing puts each name above its value, so a pair of short values takes two text lines either way. A value too long for one column, which would wrap into a tall, narrow block, asks for more room with `stackSpan` on its `Td`: `stackSpan="full"` for free text such as an error message, a query, or a browser identifier, and `stackSpan={2}` for a value such as a path that would wrap to three or more lines. At phone width the same prop puts the name above the value, so the long value gets the whole line rather than what is left beside the name. Leave it off a value that only wraps to two lines, such as an email address. A wider field can push the entry's last field onto a line of its own, and that costs more height than the wrap did.

Choose `tablet` for a table whose columns do not fit 1024px and `mobile` for one that fits a tablet but not a phone. Choose `phone` (480px) for a table in a narrow band, such as one of two side-by-side panels, where `mobile` would already stack it on a desktop. Leave the prop off for a table that reads correctly at 360px. Give every `Td` a `label` naming its column, because the header is hidden while the rows stack. Leave the label off the cell that identifies the row and off a trailing cell of action buttons: unlabelled cells are not given a column, so the identifying value heads the entry, a toggle beside it shares its line, and the buttons sit at the end of the entry's last line. Hiding the header also hides any sort buttons in it, so a sortable table passes `stackedSort` — its columns, the active column and direction, and the same `onSort` its headers call — and gets a column picker and direction toggle above the stacked rows. The picker is rendered inside the table's wrapper, so it appears exactly when the rows stack. `onSort` must follow the headers' rule: the active column flips the direction, another column switches to it. The Users tab of `/system/users` and the Database tab browsers use it.

```tsx
<Table stackAt="tablet">
    <Thead><Tr><Th>Email</Th><Th>Created</Th><Th>Actions</Th></Tr></Thead>
    <Tbody>
        <Tr>
            <Td>{account.email}</Td>
            <Td label="Created"><ClientTime date={account.createdAt} format="short" /></Td>
            <Td><Button size="sm">Details</Button></Td>
        </Tr>
    </Tbody>
</Table>
```

A table nested inside a stacked table's cell keeps its own layout; give it its own `stackAt` if it needs one. A `stickyHeader` table lets go of its scroll box while its rows are stacked, because the header it pins is hidden, so the entries scroll with the page instead of inside a box 70% of the screen tall. Plugins get the same props through `context.ui.Table` and `context.ui.Td`.

### Shrink Columns Keep Their Cells on One Line

`<Th width="shrink">` sizes a column to its widest value on one line and gives the spare width to the other columns. It suits short values: dates, status badges, counts, and a row's action buttons. The column's body cells are kept on one line as well, including content that would wrap by layout rather than by text, such as a wrapping flex row of buttons, so a shrink column never stacks its buttons or breaks a date after its comma. That makes a shrink column the wrong choice for text that should wrap, such as a description or an error message; leave `width` off that column. The cells are matched to their header by position, so keep a table with shrink columns to one header cell per column, without `colSpan`. While rows are stacked, every field wraps whatever its column's width. Anywhere on the page, a `<Button>` never breaks its label, and a `<Badge>` keeps its label on one line wherever its container leaves room, wrapping only when the container itself is narrower than the label, such as a long tool name in a narrow column on a phone.

### A Clickable Row Answers the Keyboard

A `Tr` given an `onClick` joins the tab order, runs its click when Enter or Space is pressed on the focused row, and draws a focus ring. On such a row, `isExpanded={true|false}` also renders `aria-expanded`, so a row that shows and hides its own details is announced as a toggle; leave `isExpanded` unset on a row whose click opens something else, such as a side panel. The row keeps its native row role, because `role="button"` would make its cells presentational and cut them off from their column headers. When a cell already holds a button that does the same thing as the row, such as the expand chevron in the Database tab browsers, pass `tabIndex={-1}` so keyboard users reach that action once instead of twice.

## Context Providers

Mounted once in [app/providers.tsx](../../../src/frontend/app/providers.tsx); consumed via hooks elsewhere.

| Provider | Purpose | Hook | Source |
|----------|---------|------|--------|
| `ModalProvider` | Portal-based modal stack with size variants, dismissibility, Redux tracking | `useModal()` → `{ open, close }` | [ModalProvider](../../../src/frontend/components/ui/ModalProvider/) |
| `ToastProvider` | Viewport toast queue with variants, auto-dismiss that pauses while the pointer is over a toast (along with every older toast behind it and any toast arriving during the hover), actions. `titleHref` links the title to the page that shows the event in full; `description` takes rendered content, so a value keeps the component it is shown with everywhere else (an address stays a `<TronAddress>` rather than becoming a bare string) | `useToast()` → `{ push, dismiss }` | [ToastProvider](../../../src/frontend/components/ui/ToastProvider/) |
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
