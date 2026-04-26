# UI System Overview

Summary of TronRelic's UI styling system: design tokens, SCSS Modules, layout components, and styling standards. For implementation details, follow the links to specialized documents.

## Why These Standards Matter

Hardcoded values fragment the interface and prevent theming. Global CSS classes cause naming collisions. Viewport media queries fail in constrained contexts like plugin cards or modals. TronRelic's UI system solves these with a three-layer token hierarchy, scoped SCSS Modules, and container queries.

## Core Principles

**Two-layer SCSS architecture.** `globals.scss` provides design tokens (CSS variables) and utility classes (`.surface`, `.btn`, `.badge`). SCSS Modules (`.module.scss`) provide scoped, component-specific styles. See [ui-scss-modules.md](./ui-scss-modules.md) for the complete workflow.

**Component-first layout.** React components (`<Page>`, `<Stack>`, `<Grid>`) handle page structure with TypeScript safety and IDE autocomplete. Styling utility classes handle visual patterns. See [ui-scss-modules.md](./ui-scss-modules.md#component-first-architecture) for the decision hierarchy.

**Three-layer token hierarchy.** Primitives (`primitives.scss`) define raw values. Semantic tokens (`semantic-tokens.scss`) assign purpose. Components and utility classes (`globals.scss`) apply tokens to markup. See [ui-design-token-layers.md](./ui-design-token-layers.md) for the full reference.

**Container queries over viewport media queries.** Components adapt to their container width, not the viewport. See [ui-responsive-design.md](./ui-responsive-design.md) for breakpoints and the SCSS interpolation gotcha.

**SSR-first rendering.** All public-facing components render with real data on the server. See [react.md](../react/react.md#ssr--live-updates-pattern) for the pattern and [ui-ssr-hydration.md](./ui-ssr-hydration.md) for hydration error prevention.

## Quick Reference

### Layout Components

| Component | Props | Purpose |
|-----------|-------|---------|
| `<Page>` | — | Page-level grid with responsive gap |
| `<PageHeader>` | `title`, `subtitle` | Page title section |
| `<Stack>` | `gap="sm\|md\|lg"`, `direction` | Flex container with gap |
| `<Grid>` | `gap="sm\|md\|lg"`, `columns="2\|3\|responsive"` | Grid layout |
| `<Section>` | `gap="sm\|md\|lg"` | Content section with spacing |

### Common Design Tokens

**The ideal:** every value in `.module.scss` is a semantic token — that's what enables theming. **The pragmatic split TronRelic enforces:**

- **Forbidden in component code** — `--spacing-*`, raw color palette, raw t-shirt font sizes (`--font-size-xs/sm/lg/xl/2xl/3xl`). They describe values that *should* vary by theme. Use the semantic equivalents (`--gap-*`, `--padding-*`, `--color-*`, `--font-size-body-*`, `--font-size-heading-*`).
- **Allowed in component code** — primitives whose name already describes a purpose: `--border-width-thin/medium/thick`, `--radius-xs/sm/md/lg/full`, `--shadow-sm/md/lg`, `--font-weight-*`, `--line-height-*`, `--letter-spacing-*`, `--max-width-*`. These are design constants, not theme variables; aliasing them adds ceremony without value.

If no token fits, flag the gap so a new semantic can be added — don't silently drop to a forbidden primitive.

| Category | Token to use in component code |
|----------|--------------------------------|
| Colors | `--color-text`, `--color-text-muted`, `--color-primary`, `--color-surface`, `--color-surface-muted`, `--color-border`, `--color-success`, `--color-warning`, `--color-danger` (plus `--color-*-alpha-*` and `--color-*-text` variants) |
| Gaps | `--gap-2xs/xs/sm/md/lg/xl` (generic), plus component-scoped `--stack-gap-sm/md/lg`, `--grid-gap-sm/md/lg`, `--button-gap`, `--badge-gap`, `--chip-gap` |
| Padding | `--padding-2xs/xs/sm/md/lg/xl` (generic), plus component-scoped `--card-padding-xs/sm/md/lg`, `--button-padding-xs/sm/md/lg`, `--alert-padding`, `--input-padding`, `--input-padding-sm` |
| Typography | `--font-size-caption`, `--font-size-body-sm/body/body-lg`, `--font-size-heading-sm/md/lg/xl`; `--font-weight-normal/medium/semibold/bold`; `--line-height-tight/normal/relaxed` |
| Borders | `--border-width-thin/medium/thick`, `--radius-xs/sm/md/lg/full` |
| Shadows | `--shadow-sm/md/lg` |
| Avatars | `--avatar-size-sm/md/lg` |
| Max Widths | `--max-width-prose` (64ch), `--max-width-xs/sm/md/lg/xl` (320–1080px) |
| Breakpoints | `$breakpoint-mobile-sm` (360px), `$breakpoint-mobile-md` (480px), `$breakpoint-mobile-lg` (768px), `$breakpoint-tablet` (1024px), `$breakpoint-desktop` (1200px) |

### SCSS Module Naming

Use underscores for multi-word identifiers to enable TypeScript dot notation:

| Pattern | CSS | TypeScript |
|---------|-----|-----------|
| Single word | `.card` | `styles.card` |
| Multi-word | `.market_card` | `styles.market_card` |
| BEM element | `.card__header` | `styles.card__header` |
| BEM modifier | `.card--selected` | `styles['card--selected']` |

### Common Utilities

| Pattern | Class |
|---------|-------|
| Surface | `.surface`, `.surface--padding-sm/md/lg` |
| Button | `.btn .btn--primary/secondary/ghost/danger/warning .btn--xs/sm/md/lg` |
| Badge | `.badge .badge--neutral/info/success/warning/danger` |
| Muted text | `.text-muted` |

### Icons

All icons from `lucide-react`. Sizes: 14px (inline), 16px (headings), 18px (buttons), 24px (hero). Always use CSS variables for color. See [ui-icons-and-feedback.md](./ui-icons-and-feedback.md).

## Pre-Ship Checklist

- [ ] Uses layout components for page structure
- [ ] Uses CSS variables exclusively (no hardcoded colors, spacing, fonts, or sizes)
- [ ] Component styles in colocated `.module.scss` file with underscore naming
- [ ] Uses container queries for responsiveness (not viewport media queries)
- [ ] Uses `lucide-react` for icons with design system colors
- [ ] Provides visual feedback for state changes (loading, error, success)
- [ ] Semantic HTML with ARIA labels for icon-only buttons
- [ ] Uses `ClientTime` or two-phase rendering for timestamps
- [ ] Tested in multiple contexts (full-page, slideout, modal, mobile)

## Further Reading

**Detail documents:**
- [ui-components.md](./ui-components.md) - Complete catalog of layout primitives, UI primitives, and context providers with prop summaries and source links
- [ui-scss-modules.md](./ui-scss-modules.md) - SCSS architecture, naming conventions, and component styling workflow
- [ui-responsive-design.md](./ui-responsive-design.md) - Container queries, breakpoints, and SCSS interpolation
- [ui-icons-and-feedback.md](./ui-icons-and-feedback.md) - Lucide icons, animations, and state feedback
- [ui-accessibility.md](./ui-accessibility.md) - Semantic HTML, ARIA labels, focus management, and plugin styling
- [ui-ssr-hydration.md](./ui-ssr-hydration.md) - Hydration error prevention, ClientTime, and two-phase rendering
- [ui-design-token-layers.md](./ui-design-token-layers.md) - Token hierarchy, complete reference, and W3C alignment
- [ui-theme.md](./ui-theme.md) - Theme system, admin interface, and SSR injection

**Related topics:**
- [frontend.md](../frontend.md) - Frontend architecture overview
- [frontend-architecture.md](../frontend-architecture.md) - File organization and module patterns
- [react.md](../react/react.md) - React component patterns and SSR + Live Updates
- [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) - Plugin frontend context and CSS Modules
