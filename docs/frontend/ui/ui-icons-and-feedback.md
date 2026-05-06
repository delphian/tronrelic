# Icons and State Feedback

TronRelic uses Lucide React for all icons and provides built-in animation classes for visual state feedback. This document covers icon usage, sizing conventions, and the animation patterns for loading, success, error, and update states.

## Why This Matters

Mixed icon libraries create visual inconsistency and bloat bundles. Hardcoded icon colors break when themes change. Missing state feedback leaves users uncertain whether their actions succeeded, failed, or are still processing.

Lucide React provides a single cohesive icon set that is tree-shakeable (~1-2kb per icon), TypeScript-first, and customizable via props. The built-in animation classes ensure consistent visual feedback across all components.

## Icons: Lucide React

All icons must come from `lucide-react`. Do not mix icon libraries or use custom SVGs unless absolutely necessary (brand logos).

### Usage

Import only the icons you need. Customize with props and always use CSS variables for colors:

```tsx
import { Info, AlertCircle, CheckCircle } from 'lucide-react';

<Info size={16} />
<AlertCircle size={18} style={{ color: 'var(--color-warning)' }} />
<CheckCircle size={18} style={{ color: 'var(--color-success)' }} />
```

### Standard Sizes

| Context | Size |
|---------|------|
| Inline with body text | `14px` |
| In headings or labels | `16px` |
| In buttons | `18px` |
| Hero/feature icons | `24px` |

### Common Icons

| Icon | Use Case |
|------|----------|
| `Info` | Tooltips, help text |
| `AlertCircle` | Warnings, alerts |
| `CheckCircle` | Success states |
| `XCircle` | Errors, close buttons |
| `ChevronDown` | Dropdowns, expandable sections |
| `TrendingUp` / `TrendingDown` | Positive/negative metrics |
| `ExternalLink` | External links |
| `Copy` | Copy-to-clipboard |
| `Search` | Search inputs |

Browse the full library at [lucide.dev/icons](https://lucide.dev/icons).

### Color Guidelines

Always use CSS variables for theme consistency:

```tsx
<Info style={{ color: 'var(--color-text-muted)' }} />
<AlertCircle style={{ color: 'var(--color-warning)' }} />
<XCircle style={{ color: 'var(--color-danger)' }} />
```

Acceptable alternative for subtle icons: `style={{ opacity: 0.6 }}`. Never hardcode hex colors like `color="#999"`.

## State Feedback

Always feed state changes back to the user. Most patterns ship as React components — reach for those before utility classes.

### Flash on Update

`.table-row--flash` (in `globals.scss`) animates a newly arrived or updated row with a 2.4s fade. Use on `<tr>` elements when a real-time update lands.

```tsx
<tr className={isNew ? 'table-row--flash' : undefined}>
    <td>{tx.hash}</td>
</tr>
```

`.live-indicator` (also in `globals.scss`) applies a green pulsing glow for "live" status badges and buttons.

```tsx
<button className="live-indicator">
    <Radio size={16} /> Live
</button>
```

> Known orphan: `surface--flash` and `surface--pending` are referenced as string literals in some `.tsx` files (e.g. `TransactionFeed.tsx`) but have no CSS definition — the animations never fire. Either define them in `globals.scss` or remove the call sites.

### Loading

Buttons expose a built-in loading state via a prop — they disable themselves and swap the label automatically:

```tsx
<Button variant="primary" loading={isSubmitting}>Save</Button>
```

For content placeholders during fetch, use the `<Skeleton>` primitive (see [ui-components.md](./ui-components.md)):

```tsx
<Skeleton style={{ width: '200px', height: '1.2em' }} />
```

### Errors

The base `.alert` utility class in `globals.scss` renders an alert surface (no tone modifiers currently exist — extend the class name in a CSS Module if you need variants). For row-level errors in tables, `<Tr hasError>` from the `<Table>` family applies built-in error styling.

```tsx
<div className="alert">Failed to process transaction.</div>

<Tr hasError>
    <Td colSpan={3}>{message}</Td>
</Tr>
```

## Further Reading

- [ui-scss-modules.md](./ui-scss-modules.md) - Component styling workflow and SCSS Module patterns
- [ui-accessibility.md](./ui-accessibility.md) - ARIA labels for icon buttons and focus management
- [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react) - Full API reference
- [Lucide Icon Browser](https://lucide.dev/icons) - Browse all available icons
