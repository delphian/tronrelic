# UI System Overview

Gateway to TronRelic's UI styling system: design tokens, SCSS Modules, layout components. Detail docs linked below.

## Why These Standards Matter

Hardcoded values prevent theming. Global classes collide. Viewport media queries break inside plugin cards, modals, and slideouts. The system answers with a three-layer token hierarchy, scoped SCSS Modules, container queries, and React layout primitives.

## Core Principles

**Two-layer SCSS.** `globals.scss` defines tokens and a small set of global utilities; `.module.scss` files scope component styles. See [ui-scss-modules.md](./ui-scss-modules.md).

**Component-first layout.** Page structure uses `<Page>`, `<Stack>`, `<Grid>`, `<Section>`, `<PageHeader>` from `components/layout/` — typed props beat utility classes. See [ui-scss-modules.md](./ui-scss-modules.md#component-first-architecture).

**Three-layer tokens.** Primitives → semantic tokens → component code. See [ui-design-token-layers.md](./ui-design-token-layers.md).

**Container queries, not viewport media queries.** Components adapt to whatever container they live in. See [ui-responsive-design.md](./ui-responsive-design.md).

**SSR-first rendering.** Server renders with real data; client hydrates and subscribes. See [react.md](../react/react.md#ssr--live-updates-pattern) and [ui-ssr-hydration.md](./ui-ssr-hydration.md).

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

Component code (`.module.scss`) references Layer 2 (`semantic-tokens.scss`) and never Layer 1 (`primitives.scss`). Layer 1 holds only composition inputs — `--spacing-N`, `--radius-N`, and the raw font-size scale. Within Layer 2, prefer the use-case name when one fits (`--card-padding-md`, `--button-gap`) over the value-named scales (`--gap-md`, `--radius-md`); that is guidance, not a rule. Full detail in [ui-design-token-layers.md](./ui-design-token-layers.md).

| Category | Tokens component code may reference |
|----------|--------------------------------------|
| Colors | `--color-text`, `--color-text-muted`, `--color-primary`, `--color-surface`, `--color-surface-muted`, `--color-border`, `--color-success`, `--color-warning`, `--color-danger` (plus `--color-*-alpha-*` and `--color-*-text` variants) |
| Gaps | `--gap-2xs/xs/sm/md/lg/xl` (generic), plus component-scoped `--stack-gap-sm/md/lg`, `--grid-gap-sm/md/lg`, `--button-gap`, `--badge-gap`, `--chip-gap` |
| Padding | `--padding-2xs/xs/sm/md/lg/xl` (generic), plus component-scoped `--card-padding-xs/sm/md/lg`, `--button-padding-xs/sm/md/lg`, `--input-padding-xs/sm/md/lg`, `--alert-padding` |
| Typography | `--font-size-caption`, `--font-size-body-sm/body/body-lg`, `--font-size-heading-sm/md/lg/xl`; `--font-weight-normal/medium/semibold/bold`; `--line-height-tight/normal/relaxed` |
| Borders | `--border-width-thin/medium/thick`; `--radius-xs` (4px), `--radius-sm` (10px), `--radius-md` (16px), `--radius-lg` (24px), `--radius-xl` (32px), `--radius-full` (999px, unscaled) |
| Shadows | `--shadow-sm/md/lg` |
| Avatars | `--avatar-size-sm/md/lg` |
| Max Widths | `--max-width-prose` (64ch), `--max-width-xs/sm/md/lg/xl` (320–1080px) |
| Breakpoints | `$breakpoint-mobile-sm` (360px), `$breakpoint-mobile-md` (480px), `$breakpoint-mobile-lg` (768px), `$breakpoint-tablet` (1024px), `$breakpoint-desktop` (1200px), `$breakpoint-desktop-lg` (1440px), `$breakpoint-desktop-xl` (1920px); alias `$breakpoint-mobile` = `$breakpoint-mobile-lg` (768px) |

### SCSS Module Naming

Use underscores for multi-word identifiers to enable TypeScript dot notation:

| Pattern | CSS | TypeScript |
|---------|-----|-----------|
| Single word | `.card` | `styles.card` |
| Multi-word | `.market_card` | `styles.market_card` |
| BEM element | `.card__header` | `styles.card__header` |
| BEM modifier | `.card--selected` | `styles['card--selected']` |

### Common UI Primitives

Buttons and badges are React components with scoped CSS Modules — apply them via `<Button>` and `<Badge>`, not raw class names. The only generally-usable global utility is `.text-muted`.

| Pattern | Use |
|---------|-----|
| Button | `<Button>` from `components/ui/Button` (variants: `primary/secondary/ghost/danger/warning`; sizes: `xs/sm/md/lg`) |
| Badge | `<Badge>` from `components/ui/Badge` (tones: `neutral/info/success/warning/danger`) |
| Muted text | class `text-muted` |

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
