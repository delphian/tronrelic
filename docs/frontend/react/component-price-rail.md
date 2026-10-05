# PriceRail Component

`PriceRail` places listed values and observed values on one horizontal scale. It lives in `src/frontend/components/ui/PriceRail/` and is published to plugins as `context.charts.PriceRail`.

## Why This Matters

Showing an advertised price and an observed price as two equal numbers side by side leaves the reader to work out how they relate. It also gives no sense of where the observed price sits among the options a buyer could actually choose. A rail answers that at a glance. The listed values are tick marks on one line, the span from the cheapest to the dearest is shaded, and each observed value is a marker on the same line. A reader sees immediately whether people paid near the cheapest option, near the top of the range, or outside it.

The rail is not tied to prices or to TRON. Every value is a plain number on one linear axis, and the caller supplies the formatting, so it serves any comparison of offered values against observed ones.

## How It Works

The component collects every tick and marker value, takes the smallest and largest, and adds 6% padding on each side so nothing sits flush against the ends. Each value is then converted to a percentage of the rail's width and placed with an inline `left` style. When there is only one value, or every value is equal, the rail centres it instead of dividing by a zero span.

Ticks are drawn in three places: a mark on the track, the shaded band from the lowest tick to the highest, and a label above the track showing the tick's `label` and its formatted value. Tick labels that would sit closer than 9% of the rail's width to the previous one are dropped from the label row. The tick mark stays on the track and keeps its value in a `title` tooltip. The highest tick keeps its label even if it has to displace the one before it, because the top of the range is one of the two figures a reader most needs. The exception is when the only label it could displace is the lowest tick's, which wins.

Each marker gets a toned dot on the track and its own label line underneath, so two markers with close values never overlap. Labels within 14% of either end align to that end instead of centring, so they never run off the rail. A caption under the rail shows a swatch with `bandLabel` and the `unit`.

The component holds no state and reads no browser API, so it renders the same on the server and the client. It is safe to render straight from SSR data.

## Props

Props are declared once as `IPriceRailProps` in `packages/types/src/ui/IPriceRailProps.ts`, with `IPriceRailTick` and `IPriceRailMarker` beside it.

| Prop | Type | Purpose |
|------|------|---------|
| `ticks` | `IPriceRailTick[]` | Listed values in any order. Each has `key`, `label` (a short name such as "1h"), and `value` |
| `markers` | `IPriceRailMarker[]` | Observed values. Each has `key`, `label` (a few words), `value`, and an optional `tone` of `'neutral' \| 'success' \| 'warning'` |
| `formatValue` | `(value: number) => string` | Formats a value for display |
| `bandLabel` | `string` | What the shaded band represents, for the caption |
| `unit` | `string` | The unit every value is in, for the caption and tick tooltips |
| `label` | `string` | Accessible name for the figure as a whole |

All six are required. The rail renders `null` when there are no ticks and no markers.

## Example

```tsx
const { charts } = context;

<charts.PriceRail
    label="Listed and paid prices for one USDT transfer"
    ticks={[
        { key: '1h', label: '1h', value: 2.1 },
        { key: '1d', label: '1d', value: 3.4 }
    ]}
    markers={[
        { key: 'median', label: 'median paid', value: 2.6, tone: 'success' }
    ]}
    formatValue={value => value.toFixed(2)}
    bandLabel="Listed range"
    unit="TRX per transfer"
/>
```

Core and module code imports it from the component folder: `import { PriceRail } from '../../components/ui/PriceRail';`.

## Gotchas

**Every value must be in the same unit.** The rail plots numbers and cannot tell that one tick is per day and another per rental. Convert to one unit before passing them in, and say what that unit is in `unit`.

**Keep marker labels to a value and a few words.** Each marker label takes one line under the rail and wraps only when the rail is too narrow. A sentence there makes the rail tall and hard to read. Put the explanation in surrounding prose.

**Equal ticks overlap.** Two ticks with the same value draw one mark and compete for one label. Merge them before passing them in, for example by joining their labels as "1h, 3h".

**It lives under `components/ui` but is published on `context.charts`.** It is a data visualization, so plugins find it beside `LineChart` and `BarChart`. It sits in `components/ui` because the legacy `features/charts` directory takes no new work, as [frontend.md](../frontend.md#code-goes-in-modules-not-features) explains.

## Further Reading

- [ui-components.md](../ui/ui-components.md) — the full catalog of core UI primitives
- [component-panel.md](./component-panel.md) — the section card the rail usually sits in
- [plugins-frontend-context-ui.md](../../plugins/plugins-frontend-context-ui.md) — how plugins receive this component through `context.charts`
