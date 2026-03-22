# SCSS Modules and Component Styling

SCSS Modules provide scoped, collision-free styles for React components. This document covers the two-layer SCSS architecture, naming conventions for TypeScript safety, and the step-by-step workflow for styling new components.

## Why This Matters

Without scoped styling, class name collisions break unrelated components when one is changed. Hardcoded design values fragment the interface and prevent theming. TronRelic's two-layer system solves both: `globals.scss` provides shared design tokens and utility classes, while SCSS Modules isolate component-specific styles with automatically scoped class names.

## Component-First Architecture

Before reaching for CSS, use TronRelic's React components. Styling customizes components — it does not replace them.

**Decision order:**
1. Layout components (`<Page>`, `<Stack>`, `<Grid>`) for structure
2. UI components (`<Card>`, `<Button>`, `<Badge>`) for semantic elements
3. Design tokens (`var(--color-primary)`) for customization
4. SCSS Modules for component-specific layout, states, and container queries
5. Raw `<div>` only when no existing component fits

New components should compose existing ones internally:

```tsx
export function MarketCard({ market }: Props) {
    return (
        <Card>
            <Stack gap="sm">
                <h3>{market.name}</h3>
                <Badge variant="success">{market.status}</Badge>
            </Stack>
        </Card>
    );
}
```

## Two-Layer SCSS Architecture

**Layer 1 — `globals.scss`** contains design tokens (CSS variables), utility classes (`.surface`, `.btn`, `.badge`), base resets, global animations, and viewport-level responsive styles. Layout primitives use React components instead of CSS classes.

**Layer 2 — SCSS Modules** (`.module.scss` files) contain component-specific class names, internal layout rules, hover/focus/active states, container queries, and component-scoped animations.

### What Goes Where

| Belongs in `globals.scss` | Belongs in SCSS Modules |
|--------------------------|------------------------|
| CSS variables (`--color-*`, `--spacing-*`) | Component grid/flex layout |
| Utility classes (`.surface`, `.btn`) | Component hover/focus states |
| Base resets, element defaults | Container queries |
| Global keyframe animations | Component-scoped transitions |
| Viewport layout breakpoints | Anything used by only one component |

## SCSS Module Naming Conventions

SCSS Modules generate typed objects in TypeScript. Use underscores for multi-word identifiers to enable clean dot notation (`styles.market_card`) instead of bracket notation (`styles['market-card']`).

| Pattern | CSS Class | TypeScript Access |
|---------|-----------|-------------------|
| Single word | `.card` | `styles.card` |
| Multi-word | `.market_card` | `styles.market_card` |
| BEM element | `.card__header` | `styles.card__header` |
| BEM element (multi-word) | `.card__header_title` | `styles.card__header_title` |
| BEM modifier | `.card--selected` | `styles['card--selected']` |

BEM modifiers with `--` still require bracket notation, but they appear less frequently than base classes and elements. Prioritize underscores for all multi-word identifiers.

## How to Style Components

### Step 1: Create the SCSS Module

Place the file next to your component. Name it `ComponentName.module.scss`.

```
components/MarketCard/
├── MarketCard.tsx
├── MarketCard.module.scss
└── index.ts
```

### Step 2: Import and Apply

```typescript
import styles from './MarketCard.module.scss';

<Card className={styles.card}>
    <Stack gap="sm">
        <Badge variant="success">{status}</Badge>
        <div className={styles.custom_layout}>
            <p className="text-muted">{description}</p>
        </div>
    </Stack>
</Card>
```

Use React components for cards, layout, buttons, and badges. Use SCSS Modules for custom internal layouts, unique hover/focus states, container queries, and domain-specific visual treatments.

### Step 3: Reference Design Tokens

Always use semantic tokens from `semantic-tokens.scss`. Tokens are immutable — select different tokens at different breakpoints instead of redefining what tokens mean.

```scss
@use '../../../app/breakpoints' as *;

.card {
    container-type: inline-size;
    container-name: market-card;
}

.title {
    color: var(--color-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
}

/* CORRECT - select smaller token at narrow width */
@container market-card (max-width: 300px) {
    .price { font-size: var(--font-size-xl); }
}
```

Never hardcode colors, spacing, fonts, or sizes. Never redefine tokens across breakpoints — this makes names meaningless and debugging impossible.

## Complete Example

```tsx
import { Card } from '../../../../components/ui/Card';
import { Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import styles from './MarketCard.module.scss';

/**
 * Displays energy market provider information with pricing and availability.
 * Composes Card, Stack, and Badge; adds domain-specific styling via SCSS Module.
 */
export function MarketCard({ name, price, availability }: MarketCardProps) {
    return (
        <Card className={styles.card}>
            <Stack gap="sm">
                <div className={styles.header}>
                    <h3 className={styles.title}>{name}</h3>
                    <Badge variant="success">{availability}</Badge>
                </div>
                <div className={styles.price}>{price.toLocaleString()} TRX</div>
            </Stack>
        </Card>
    );
}
```

```scss
@use '../../../../app/breakpoints' as *;

.card { container-type: inline-size; container-name: market-card; }
.header { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--color-primary); }
.price { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--color-text); }

@container market-card (max-width: 300px) {
    .header { flex-direction: column; align-items: flex-start; gap: var(--spacing-4); }
    .price { font-size: var(--font-size-xl); }
}
```

## Further Reading

- [ui-responsive-design.md](./ui-responsive-design.md) - Container queries, breakpoints, and the SCSS variable interpolation gotcha
- [ui-icons-and-feedback.md](./ui-icons-and-feedback.md) - Lucide icons, animations, and state feedback patterns
- [ui-accessibility.md](./ui-accessibility.md) - Semantic HTML, ARIA labels, and plugin styling rules
- [ui-design-token-layers.md](./ui-design-token-layers.md) - Complete token hierarchy, naming conventions, and reference
- [ui-ssr-hydration.md](./ui-ssr-hydration.md) - Hydration error prevention for timezone-sensitive data
- [frontend-architecture.md](../frontend-architecture.md) - File organization and component folder patterns
