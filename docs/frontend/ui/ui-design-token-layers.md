# Design Tokens

TronRelic's design tokens are CSS variables that name design decisions (colors, spacing, typography, radii, shadows). The system follows the three-layer pattern used by W3C-DTCG, Material Design, Adobe Spectrum, and Shopify Polaris — primitives at the bottom, semantic aliases in the middle, component code on top.

## Why This Matters

Hardcoded values fragment the UI and make theming impossible. Three layers give a single source of truth at each level: change one semantic token and every component that aliases it updates; theme switching is a remap, not a rewrite. The price of breaking the layering is exactly what it sounds like — token names that lie, themes that don't propagate, mobile breakpoints that redefine "medium" until the word means nothing.

## The Three Layers

### Layer 1 — Foundation Primitives (`primitives.scss`)

Raw values with no use-case meaning. Color palette (`--color-blue-500`), spacing scale (`--spacing-1` through `--spacing-20`), raw t-shirt font sizes (`--font-size-xs/sm/md/lg/xl/2xl/3xl`), font weights, line heights, radii, shadows.

### Layer 2 — Semantic Tokens (`semantic-tokens.scss`)

Use-case names that alias primitives: `--color-text`, `--color-danger`, `--card-padding-md`, `--button-padding-md`, `--button-border-radius`, `--card-shadow`, `--card-border-radius`, `--font-size-heading-md`, `--font-size-body`, `--max-width-prose`. These are the chokepoint themes remap to switch dark/light/brand variants.

`semantic-tokens.scss` also hosts curated t-shirt-sized scales — `--gap-2xs/xs/sm/md/lg/xl`, `--padding-2xs/xs/sm/md/lg/xl`, `--avatar-size-sm/md/lg`. **By industry convention these are still primitives** (the names describe values, not use cases — Spectrum, Tailwind v4, Carbon, Atlassian classify their equivalents the same way). They live in this file because it is the curated chokepoint of *tokens component code may reference*, not a strict semantic-only collection.

### Layer 3 — Component Code (`.module.scss`, `globals.scss` utilities)

Where tokens meet markup. Component CSS Modules consume tokens; `globals.scss` defines the small set of global utility classes (`.text-muted`, `.chip`, `.alert`, etc.).

## The Four-Tier Rule for Component Code

Component CSS reaches for tokens in this order:

1. **Use-case-named semantic tokens** when one exists — `--color-text`, `--color-danger`, `--card-padding-md`, `--button-gap`, `--stack-gap-md`, `--font-size-heading-md`, `--font-size-body`, `--max-width-prose`. **Always preferred.**
2. **Curated t-shirt primitives in `semantic-tokens.scss`** — `--gap-*`, `--padding-*`, `--avatar-size-*`. Acceptable when no use-case-named semantic fits.
3. **Design-constant primitives in `primitives.scss`** — `--border-width-thin/medium/thick`, `--radius-xs/sm/md/lg/full`, `--shadow-sm/md/lg`, `--font-weight-*`, `--line-height-*`, `--letter-spacing-*`, `--max-width-*`. These don't shift between themes; aliasing them through Layer 2 adds ceremony without value, so reach for them directly.
4. **Forbidden in component code** — the foundation scales: `--spacing-1`...`--spacing-20`, raw color palette (`--color-blue-500`), raw t-shirt font sizes (`--font-size-xs/sm/md/lg/xl/2xl/3xl`).

If no token in tiers 1–3 fits, **flag the gap so a use-case-named semantic can be added**. Don't silently drop to a forbidden foundation primitive.

## Size-Variant Convention

Component-scoped semantic tokens that vary by density use the `xs | sm | md | lg` suffix uniformly. Buttons expose `--button-padding-xs/sm/md/lg`, `--button-font-size-xs/sm/md/lg`, `--button-height-xs/sm/md/lg`. Cards expose `--card-padding-xs/sm/md/lg`. Inputs expose `--input-padding` and `--input-padding-sm` (dense inline variant). When adding a new component-scoped density, extend the same four-step ladder rather than inventing a parallel scale — callers then pick the step that matches the visual weight they need, and responsive rules swap tokens instead of redefining them.

## Token Immutability — Components Select, Tokens Don't Redefine

A token's value never changes based on breakpoint or context. Components switch *which token they reference* at each breakpoint instead of redefining what tokens mean.

```scss
/* CORRECT — component selects the appropriate token at each breakpoint */
.card--padding-md {
    padding: var(--card-padding-md);  /* 1.5rem */
}

@media (max-width: $breakpoint-mobile-lg) {
    .card--padding-md {
        padding: var(--card-padding-sm);  /* 1rem */
    }
}

@media (max-width: $breakpoint-mobile-sm) {
    .card--padding-md {
        padding: var(--card-padding-xs);  /* 0.5rem */
    }
}
```

```scss
/* WRONG — redefines what "md" means across breakpoints */
:root {
    --card-padding-md: 1.5rem;
}
@media (max-width: $breakpoint-mobile-lg) {
    :root {
        --card-padding-md: 0.75rem;  /* "Medium" now means 12px? */
    }
}
```

Why this matters: when `--card-padding-md` always means the same value, the name stays honest and developers can trust it. The moment tokens redefine across breakpoints, "medium" describes nothing and debugging requires checking definitions at every viewport.

**Reference implementation:** `src/frontend/components/ui/Card/Card.module.scss` (lines 43–79) cascades `--card-padding-lg → -md → -sm → -xs` across three breakpoints. Tokens themselves never change.

## Breakpoints

Breakpoints are **SCSS variables** in `_breakpoints.scss`, not CSS custom properties — CSS variables cannot be used in `@media` or `@container` queries. Asia-optimized: 360px is the dominant mobile width in Asia (~13.73% market share vs. 10.12% globally), so the mobile tier splits into three steps to handle mid-range Android density.

| SCSS Variable | Value | Target |
|---------------|-------|--------|
| `$breakpoint-mobile-sm` | 360px | Legacy / very small devices |
| `$breakpoint-mobile-md` | 480px | Primary mobile target (mid-range Android) |
| `$breakpoint-mobile-lg` | 768px | Large phones, landscape |
| `$breakpoint-tablet` | 1024px | Tablets, small laptops |
| `$breakpoint-desktop` | 1200px | Desktop displays |
| `$breakpoint-desktop-lg` | 1440px | Wide desktop / 1440p monitors; site-wide content cap |
| `$breakpoint-desktop-xl` | 1920px | Full HD |
| `$breakpoint-mobile` *(alias)* | = `$breakpoint-mobile-lg` (768px) | Convenience for the common mobile cutoff |

Container queries are preferred over viewport media queries; reserve `@media` for global layout in `app/layout.tsx`. The variable interpolation gotcha (`#{$breakpoint-mobile-md}` inside `@container`) lives in [ui-responsive-design.md](./ui-responsive-design.md).

```scss
@use '../../../app/breakpoints' as *;

.component {
    container-type: inline-size;
}

@container (max-width: #{$breakpoint-mobile-md}) {
    .component { /* 480px and below */ }
}
```

## Theme Customization

Themes override semantic tokens via custom CSS attached to a `[data-theme="UUID"]` selector — no source-file changes needed. Themes persist in MongoDB and apply via SSR injection. See [ui-theme.md](./ui-theme.md) before creating or modifying a theme.

## Further Reading

**Source files:**
- [primitives.scss](../../../src/frontend/app/primitives.scss) — Foundation primitives
- [semantic-tokens.scss](../../../src/frontend/app/semantic-tokens.scss) — Semantic tokens + curated t-shirt scales
- [globals.scss](../../../src/frontend/app/globals.scss) — Global utility classes
- [_breakpoints.scss](../../../src/frontend/app/_breakpoints.scss) — Breakpoint variables (single source of truth)

**Related docs:**
- [ui-scss-modules.md](./ui-scss-modules.md) — How component CSS Modules consume these tokens
- [ui-responsive-design.md](./ui-responsive-design.md) — Container queries and the SCSS interpolation gotcha
- [ui-theme.md](./ui-theme.md) — Theme system, admin overrides, SSR injection
