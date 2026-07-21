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
2. **Curated t-shirt primitives in `semantic-tokens.scss`** — `--gap-*`, `--padding-*`, `--radius-xs/sm/md/lg/xl/full`, `--avatar-size-*`. Acceptable when no use-case-named semantic fits.
3. **Design-constant primitives in `primitives.scss`** — `--border-width-thin/medium/thick`, `--shadow-sm/md/lg`, `--font-weight-*`, `--line-height-*`, `--letter-spacing-*`, `--max-width-*`. These don't shift between themes; aliasing them through Layer 2 adds ceremony without value, so reach for them directly. Radius is **not** in this tier: the t-shirt scale carries the `--density` factor, so consuming a foundation radius silently opts that corner out of density scaling.
4. **Forbidden in component code** — the foundation scales: `--spacing-1`...`--spacing-20`, `--radius-1`...`--radius-6`, raw color palette (`--color-blue-500`), raw t-shirt font sizes (`--font-size-xs/sm/md/lg/xl/2xl/3xl`).

If no token in tiers 1–3 fits, **flag the gap so a use-case-named semantic can be added**. Don't silently drop to a forbidden foundation primitive.

## Layer 2 Composition Rules

Layer 2 tokens must derive from theme-controlled tokens. Literal values short-circuit the cascade — a theme override of `--color-primary` cannot reach surfaces whose tokens bake in literal blue.

**No literals in themable Layer 2 tokens.** Any semantic token a theme is expected to override — colors, gradients, shadows tinted by brand — must compose from `--color-primary` (or sibling brand tokens) via `var()`, the alpha ladder, or `color-mix()`. Literal `rgba(…)` and hex values survive in `semantic-tokens.scss` only on tokens that should *not* theme: status base colors (`--color-danger: #ff6f7d` is the source of truth), dark backdrop primitives, fully neutral whites/blacks.

**No half-derived tokens.** A token that mixes `var(--color-primary)` with a literal stop (e.g., `linear-gradient(135deg, var(--color-primary), #6da3ff)`) themes the derived half and freezes the literal half. The result is a visible color shear when the theme remaps primary. Derive every stop from theme-controlled values; use `color-mix(in srgb, var(--color-primary) 70%, white)` for a lighter variant.

**No duplicate token names across layers.** Defining the same token in both `primitives.scss` and `semantic-tokens.scss` creates dead code — the later file wins the cascade silently. Semantic-named tokens belong in Layer 2; raw scales in Layer 1. A token name may appear only once in the source tree.

### Alpha Ladder

Brand-tinted overlays — focus rings, hover washes, badge backgrounds, gradient stops — consume `--color-primary` at fixed opacities. Express the ladder once in Layer 2; downstream consumers reference it:

```scss
--color-primary-alpha-10: color-mix(in srgb, var(--color-primary) 10%, transparent);
--color-primary-alpha-15: color-mix(in srgb, var(--color-primary) 15%, transparent);
--color-primary-alpha-18: color-mix(in srgb, var(--color-primary) 18%, transparent);
--color-primary-alpha-30: color-mix(in srgb, var(--color-primary) 30%, transparent);
--color-primary-alpha-38: color-mix(in srgb, var(--color-primary) 38%, transparent);
```

Identical ladders exist for `--color-success-alpha-*`, `--color-danger-alpha-*`, `--color-warning-alpha-*`. Adding a new alpha step is a Layer 2 edit, not a per-call decision.

### color-mix() for Theme-Aware Variants

When a token needs a variant of a brand color and no alpha-ladder entry fits, derive it inline:

```scss
/* Lighter primary for gradient sheen */
--button-primary-background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, white));

/* Primary at 25% opacity for colored drop-shadow */
--button-primary-shadow: 0 20px 36px color-mix(in srgb, var(--color-primary) 25%, transparent);
```

`color-mix(in srgb, …)` is supported across all evergreen browsers since early 2023. Prefer it over hand-computed rgba values whose RGB triple decouples from `--color-primary` and stops themable.

### Text-Contrast Companions

Brand colors that appear as solid surfaces (primary, future on-secondary) pair with a `--color-on-X` token for the text/icon color drawn on top. Themes override `--color-on-X` whenever their brand value's luminance crosses the contrast threshold — a dark primary needs light on-primary, a light primary needs dark.

This is distinct from `--color-X-text`, which is calibrated for text on `--color-X-alpha-*` washes, not on solid X. `--color-danger-text: #ffc1c8` reads correctly on the muted danger overlay; the same token would fail contrast against solid `--color-danger`. Two different concerns, two different tokens.

```scss
--color-on-primary: #0b1020;        /* dark text on default light-blue primary */
--button-primary-color: var(--color-on-primary);
```

Add `--color-on-X` for additional brand colors only when a real surface needs one — preemptive tokens accumulate unused.

### Intentional Literal Exceptions

Three categories of literal colors are legitimate and should *not* be forced through the token system:

1. **Functional fixed colors.** QR-code backgrounds (`#ffffff`), barcode foregrounds — colors required for the artifact to be scanned or read by external systems. Themes must not change them.
2. **Data-visualization palettes.** Heatmap green→red gradients, chart series colors that encode data semantics rather than brand identity. The mapping is part of the data, not the theme.
3. **Plugin-local design tokens.** A plugin with its own bounded palette (five-elements colors, ranking medal hues) should declare them as plugin-local CSS variables on the component (`--bazi-element-wood`, `--leaderboard-medal-gold`) and consume through `var()`. The plugin owns its design tokens; the core theme system does not try to override them.

Declare the intent in a comment so the next audit reads it as deliberate, not as a missed leak.

## Size-Variant Convention

Component-scoped semantic tokens that vary by density use the `xs | sm | md | lg` suffix uniformly. Buttons expose `--button-padding-xs/sm/md/lg`, `--button-font-size-xs/sm/md/lg`, `--button-height-xs/sm/md/lg`. Cards expose `--card-padding-xs/sm/md/lg`. Inputs expose `--input-padding-xs/sm/md/lg`, shared by `<Input>`, `<Textarea>`, and `<Select>` (`--input-padding` survives as a deprecated alias for `-md`; prefer the `size` prop). When adding a new component-scoped density, extend the same four-step ladder rather than inventing a parallel scale — callers then pick the step that matches the visual weight they need, and responsive rules swap tokens instead of redefining them.

`xs` derives from `sm` at half scale, expressed as `calc(… * 0.5)` off the same primitive so the relationship survives a change to the scale underneath. Halving stops where a value has a functional floor rather than an aesthetic one: `--button-height-xs` holds at 24px because half of `sm` is a 17px target, under the WCAG 2.2 SC 2.5.8 minimum, and `--button-font-size-xs` holds at 0.72rem because half of `sm` is unreadable. A ladder step is a design decision, not arithmetic.

## Token Immutability — Components Select, Tokens Don't Redefine

A token's value never changes based on breakpoint or context. Rules switch *which token they reference* instead of redefining what tokens mean.

```scss
/* CORRECT — the rule selects a different token at the narrow breakpoint */
.table th,
.table td {
    padding: var(--table-cell-padding);
}

@media (max-width: $breakpoint-mobile) {
    .table th,
    .table td {
        padding: var(--table-cell-padding-compact);
    }
}
```

```scss
/* WRONG — redefines what the token means */
:root {
    --table-cell-padding: 0.85rem 1.1rem;
}
@media (max-width: $breakpoint-mobile) {
    :root {
        --table-cell-padding: 0.4rem 0.5rem;  /* the name now describes nothing */
    }
}
```

Why this matters: when `--table-cell-padding` always means the same value, the name stays honest and developers can trust it. The moment tokens redefine across breakpoints, the name describes nothing and debugging requires checking definitions at every viewport.

**Reference implementation:** `src/frontend/app/globals.scss` — the mobile block selects `--table-cell-padding-compact` rather than redefining `--table-cell-padding`.

Immutability governs how a rule *picks* a token; it does not oblige a component to pick by breakpoint at all. Where density is a `size` or `padding` prop, the caller owns the choice and the component holds it at every width — `<Card>` works this way deliberately, so a surface that wants a tighter card asks for `padding="xs"` instead of inheriting a step-down it cannot see. Reach for a responsive rule when the *component* must adapt to its own space, and prefer `@container` over `@media` when you do (see [ui-responsive-design.md](./ui-responsive-design.md)).

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

## Auditing Token Compliance

Drift accumulates quietly. A periodic grep catches most of it:

```bash
# Layer 3/4 — color literals in component and plugin code
grep -rnE 'rgba?\(|#[0-9a-fA-F]{6}' \
    src/frontend/components src/frontend/modules src/frontend/features src/plugins \
    --include="*.scss" 2>/dev/null \
    | grep -vE 'var\(--|/\*|//'

# Layer 2 — blue/cyan literals that should derive from --color-primary/secondary
grep -nE 'rgba?\(([0-9]+,\s*){2}(2[0-9]{2}|1[5-9][0-9])' \
    src/frontend/app/semantic-tokens.scss
```

Hits are either real violations (replace with semantic tokens, the alpha ladder, or `color-mix()`) or intentional literals from the exception carveout above. The latter should already carry an explaining comment; if they don't, add one and consider whether a plugin-local variable would be cleaner.

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
