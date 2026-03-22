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

## State Feedback Animations

Always provide visual feedback for state changes using the built-in animation classes from `globals.scss`.

### Flash Animations

Draw attention to newly added or updated content:

```tsx
<tr className="table-row--flash">
    <td>New transaction data</td>
</tr>

<div className="surface surface--flash">
    Updated content
</div>
```

### Loading States

Show pending states with visual feedback:

```tsx
<div className="surface surface--pending">
    Content loading...
</div>

<button className="btn btn--primary btn--loading" disabled>
    Processing...
</button>

<div className="skeleton" style={{ width: '200px', height: '1.2em' }} />
```

### Error States

Indicate errors visually:

```tsx
<div className="surface surface--error">
    Error loading data
</div>

<div className="alert alert--danger">
    Failed to process transaction
</div>
```

## Further Reading

- [ui-scss-modules.md](./ui-scss-modules.md) - Component styling workflow and SCSS Module patterns
- [ui-accessibility.md](./ui-accessibility.md) - ARIA labels for icon buttons and focus management
- [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react) - Full API reference
- [Lucide Icon Browser](https://lucide.dev/icons) - Browse all available icons
