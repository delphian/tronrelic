# Responsive Design with Container Queries

TronRelic components adapt to their container's width using CSS container queries, not viewport media queries. This ensures components render correctly in any context — full pages, sidebars, modals, or plugin cards.

## Why This Matters

Viewport media queries (`@media`) assume components occupy the full viewport. When a component renders in a sidebar (45% width), a modal, or a plugin card, viewport breakpoints apply the wrong responsive rules. Container queries solve this by letting each component define responsive behavior based on its own container width.

Without container queries, components that look correct on full pages collapse in narrow contexts. Plugins loaded into cards or slideouts inherit wrong responsive rules and must be rewritten for each context.

## How Container Queries Work

### 1. Declare a Container

Mark the responsive wrapper with `container-type` and a semantic name:

```scss
.analytics_card {
    container-type: inline-size;
    container-name: analytics-card;
}
```

### 2. Write Container-Scoped Rules

Use `@container` instead of `@media`. Import breakpoints from `_breakpoints.scss` for consistent values.

```scss
@use '../../../app/breakpoints' as *;

.analytics_card { padding: var(--card-padding-md); }

@container analytics-card (min-width: #{$breakpoint-mobile-md}) {
    .grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--grid-gap-sm);
    }
}

@container analytics-card (min-width: #{$breakpoint-mobile-lg}) {
    .grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--grid-gap-md);
    }
    .analytics_card { padding: var(--card-padding-lg); }
}
```

### 3. Use Semantic Container Names

Choose descriptive names matching the component's purpose: `market-card`, `transaction-panel`, `whale-dashboard`. This makes debugging straightforward.

### 4. Reserve @media for Global Layout Only

Use viewport media queries exclusively for layout shells (navigation, page chrome) defined in `app/layout.tsx`. Component-level responsiveness always uses `@container`.

## SCSS Variable Interpolation Gotcha

Container queries require `#{$variable}` interpolation. Without it, the rule compiles but the condition is silently dropped ([Sass #3471](https://github.com/sass/sass/issues/3471)):

```scss
/* Works */  @container my-card (max-width: #{$breakpoint-mobile}) { ... }
/* Fails */  @container my-card (max-width: $breakpoint-mobile) { ... }
/* Works */  @media (max-width: $breakpoint-mobile) { ... }
```

Media queries do not need interpolation. Container queries always do.

## Token Immutability in Responsive Rules

Both container queries and media queries must follow the token immutability principle: select different tokens at different breakpoints instead of redefining what tokens mean.

```scss
/* CORRECT - select appropriate token */
@container card (max-width: #{$breakpoint-mobile-lg}) {
    .card { padding: var(--card-padding-sm); }
}

/* WRONG - redefine what "md" means */
@container card (max-width: #{$breakpoint-mobile-lg}) {
    :root { --card-padding-md: 0.75rem; }
}
```

See [ui-design-token-layers.md](./ui-design-token-layers.md) for the full immutability rationale.

## Breakpoint Reference

TronRelic uses an Asia-optimized breakpoint system. Breakpoints are SCSS variables (not CSS custom properties) defined in `_breakpoints.scss`.

| Variable | Value | Target |
|----------|-------|--------|
| `$breakpoint-mobile-sm` | 360px | Legacy/small devices |
| `$breakpoint-mobile-md` | 480px | Primary mobile (mid-range Android) |
| `$breakpoint-mobile-lg` | 768px | Large phones, landscape |
| `$breakpoint-tablet` | 1024px | Tablets, small laptops |
| `$breakpoint-desktop` | 1200px | Desktop displays |

Import with `@use '../../../app/breakpoints' as *;` at the top of any SCSS Module that uses them.

## Complete Example

```tsx
import { Card } from '../../../components/ui/Card';
import styles from './TransactionCard.module.scss';

/**
 * Displays transaction details in a responsive grid that adapts
 * based on container width. Uses Card for surface styling.
 */
export function TransactionCard({ transaction }: { transaction: ITransaction }) {
    return (
        <Card className={styles.card}>
            <div className={styles.grid}>
                <div className={styles.stat}>Hash: {transaction.hash}</div>
                <div className={styles.stat}>Amount: {transaction.amount}</div>
                <div className={styles.stat}>Status: {transaction.status}</div>
            </div>
        </Card>
    );
}
```

```scss
@use '../../../app/breakpoints' as *;

.card { container-type: inline-size; container-name: transaction-card; }
.grid { display: grid; grid-template-columns: 1fr; gap: var(--grid-gap-sm); }
.stat { font-size: var(--font-size-sm); color: var(--color-text-muted); }

@container transaction-card (min-width: #{$breakpoint-mobile-md}) {
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--grid-gap-sm); }
}

@container transaction-card (min-width: #{$breakpoint-mobile-lg}) {
    .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--grid-gap-md); }
}
```

This component adapts whether rendered full-width, inside a 45%-width slideout, or within a plugin card.

## Further Reading

- [ui-scss-modules.md](./ui-scss-modules.md) - SCSS Module architecture, naming conventions, and styling workflow
- [ui-design-token-layers.md](./ui-design-token-layers.md) - Token hierarchy and immutability principle
- [CSS Container Queries (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Container_Queries) - Specification reference
