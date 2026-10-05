# FigureList Component

`FigureList` renders figures as statement-style label-and-value rows. It lives in `src/frontend/components/ui/FigureList/` and is published to plugins as `context.ui.FigureList`.

## Why This Matters

`StatTile` is the right component for a headline band of a few figures. It is the wrong one for a section of ten or more. A row of five tiles leaves orphans with empty space beside them, the tile borders outweigh the numbers, and a section of ten figures takes a full screen. A reader scanning many figures reads them the way a financial statement or a fact sheet is laid out: a column of labels and a column of values. `FigureList` renders that layout.

Use this rule to choose between them. Reach for `StatGrid` with `StatTile` when a band holds a handful of headline figures that each deserve weight. Reach for `FigureList` when a section holds many figures, or when the figures sit beside another block in a narrow column.

## How It Works

The component renders a `<dl>`. Each row is a `<div>` holding a `<dt>` for the label, a `<dd>` for the value, and an optional second `<dd>` for the note. The label sits on the left in muted type, and the value sits on the right in semibold tabular figures, so numbers line up down the column. A unit, when given, follows the value in smaller muted type so the number stays the loudest thing in the row. A hairline separates rows instead of a box around each one.

With `columns="auto"`, the default, the list is an auto-fill grid whose columns are at least `--max-width-xs` wide. The list therefore flows from one column in a narrow panel to several in a wide one, with no breakpoint rules at the call site. `columns="single"` holds one column for a list placed beside another block that already sets the width.

Values render exactly as passed. Unit, precision, and locale are decisions the caller owns.

## Props

Props are declared once as `IFigureListProps` in `packages/types/src/ui/IFigureListProps.ts`, with the row shape as `IFigureListRow` in `packages/types/src/ui/IFigureListRow.ts`.

| Prop | Type | Purpose |
|------|------|---------|
| `rows` | `IFigureListRow[]` | The figures, in reading order. An empty array renders nothing. Required |
| `label` | `string` | Accessible name for a list with no visible heading of its own beside it |
| `columns` | `'auto' \| 'single'` | `auto` flows into as many columns as fit; `single` holds one |
| `className` | `string` | Layout the caller owns |

Each row is an `IFigureListRow`:

| Field | Type | Purpose |
|-------|------|---------|
| `key` | `string` | Stable React key. Required |
| `label` | `ReactNode` | What the figure measures, in sentence case. Required |
| `value` | `ReactNode` | The figure, already formatted. Required |
| `unit` | `string` | Unit shown after the value in muted type |
| `note` | `ReactNode` | A qualifier shown under the label, so the figure is not read out of context |
| `tone` | `'default' \| 'success' \| 'warning'` | Colours the value when the figure carries a verdict |

## Example

```tsx
const { ui } = context;

<ui.Panel title="Key facts">
    <ui.FigureList
        columns="single"
        rows={[
            { key: 'latency', label: 'Median delivery', value: '4.2', unit: 's' },
            { key: 'served', label: 'Orders served', value: '98.1', unit: '%', tone: 'success' },
            { key: 'suppliers', label: 'Active suppliers', value: '37', note: 'Seen delegating in the last 24 hours' }
        ]}
    />
</ui.Panel>
```

Core and module code imports it from the component folder: `import { FigureList } from '../../components/ui/FigureList';`.

## Gotchas

**Keep the value short.** The value column does not wrap, so the label column can shrink and wrap instead. A long value such as a sentence pushes the label into a narrow strip. Put the explanation in `note` and keep `value` to the figure.

**Tone is a verdict, not decoration.** Colour only the figures a reader should notice. Colouring every row spends the signal, the same as it does on `StatTile`.

**It renders `null` for an empty list.** That is deliberate, so a caller can render it unconditionally, but it also means an empty section shows nothing at all. If an empty state needs explaining, render that message yourself when `rows` is empty.

## Further Reading

- [ui-components.md](../ui/ui-components.md) — the full catalog, including `StatTile` and `StatGrid`
- [component-panel.md](./component-panel.md) — the section card a figure list usually sits in
- [plugins-frontend-context-ui.md](../../plugins/plugins-frontend-context-ui.md) — how plugins receive this component through `context.ui`
