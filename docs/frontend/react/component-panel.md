# Panel Component

`Panel` is one titled section of a data page drawn as a single card. It lives in `src/frontend/components/ui/Panel/` and is published to plugins as `context.ui.Panel`.

## Why This Matters

Data pages tend to wrap each section in a `Card`, then draw a second bordered box around every figure inside it. The page ends up as boxes inside boxes, and most of its area goes to borders and padding instead of data. A panel gives a section exactly one level of containment: a header row, then the content with nothing framed inside it.

The header row also solves a second problem. A fact that every row in the section shares, such as the date range, the sample size, or a pager, is stated once beside the title instead of being repeated in each row or stacked as an extra line above the content.

## How It Works

`Panel` renders a `Card` with `padding="sm"`, then a `<section>` holding a `<header>` and the children. The header puts the title, the `meta` line, and the `actions` on one row. The meta line grows to fill the space between them, which pushes the actions to the end of the row, and the row wraps only when the panel is too narrow to hold all three.

The title is styled at `--font-size-heading-sm` whatever heading level you choose, because a panel title labels a block of figures and should not outgrow them. `titleAs` changes only the element, so the document outline stays correct when the panel is nested under another heading.

The card declares itself a size container named `panel`. Content inside it can use `@container panel (…)` queries to respond to the panel's width, which is what lets the same content sit in a two-across band on desktop and a single column on mobile.

## Props

Props are declared once as `IPanelProps` in `packages/types/src/ui/IPanelProps.ts`, and the component imports that type rather than restating it.

| Prop | Type | Purpose |
|------|------|---------|
| `title` | `ReactNode` | Section heading. Required |
| `titleAs` | `'h2' \| 'h3' \| 'h4'` | Heading element. Defaults to `h2`; lower it when the panel is nested under another heading |
| `meta` | `ReactNode` | Muted context shared by the whole section, such as the period covered |
| `actions` | `ReactNode` | Controls for the content, such as a pager or a toggle, placed at the end of the header row |
| `tone` | `'default' \| 'muted'` | `muted` for panels that explain rather than report, such as methodology notes |
| `id` | `string` | Anchor id, so a link elsewhere on the page can jump to the panel |
| `className` | `string` | Layout the caller owns, such as `break-inside: avoid` inside a multi-column flow |
| `children` | `ReactNode` | The content |

## Example

```tsx
const { ui } = context;

<ui.Panel
    title="Recent rentals"
    meta="Last 7 days, newest first"
    actions={<ui.Button size="xs" variant="ghost" onClick={nextPage}>Next</ui.Button>}
>
    <ui.Table variant="compact" flush>…</ui.Table>
</ui.Panel>
```

Core and module code imports it from the component folder instead: `import { Panel } from '../../components/ui/Panel';`.

## Gotchas

**Do not nest a `Card` inside a panel to frame its content.** That brings back the boxes-inside-boxes problem the panel exists to fix. A table that is the last thing in the panel should pass `flush` so it runs to the panel's edges, as described in [ui-components.md](../ui/ui-components.md#a-table-inside-a-card-runs-to-the-cards-edges). A list of figures should use [FigureList](./component-figure-list.md).

**Keep `meta` short.** It shares the header row with the title and the actions. A long sentence there wraps onto a second line and pushes the actions down with it. Put an explanation in the content, or in a closing `tone="muted"` notes panel.

**The container name is `panel` for every panel.** A container query inside a panel that is itself nested in another panel matches the nearest one, which is usually what you want. If it is not, give the inner element its own container name.

## Further Reading

- [ui-components.md](../ui/ui-components.md) — the full catalog of core UI primitives
- [component-figure-list.md](./component-figure-list.md) — the label-and-value list usually placed inside a panel
- [component-price-rail.md](./component-price-rail.md) — the scale chart that shares the panel on the resource-markets detail page
- [plugins-frontend-context-ui.md](../../plugins/plugins-frontend-context-ui.md) — how plugins receive this component through `context.ui`
