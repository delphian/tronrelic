# UI System Overview

This is the gateway to TronRelic's UI styling system: design tokens, SCSS Modules, and layout components. The detail documents are linked at the end.

A **design token** is a named CSS custom property, such as `--color-primary`, that holds a design decision in one place so every component can reference it instead of repeating the underlying value. An **SCSS Module** is a stylesheet named `Component.module.scss` whose class names are automatically made unique at build time, so they cannot collide with styles anywhere else.

## Why These Standards Matter

Hardcoded values make theming impossible, because there is no single place to change. Global class names collide as the codebase grows. Viewport media queries break inside plugin cards, modals, and slideouts, because the width of the window does not tell you the width of the container the component was placed in. The system solves those three problems with a three-layer token hierarchy, SCSS Modules that scope their own class names, container queries, and React components for layout.

## Core Principles

**Two layers of SCSS.** `globals.scss` defines the tokens and a small set of global utility classes. Each `.module.scss` file scopes the styles for one component. See [ui-scss-modules.md](./ui-scss-modules.md).

**Layout comes from components.** Build page structure with `<Page>`, `<Stack>`, `<Grid>`, `<Section>`, and `<PageHeader>` from `components/layout/`. Typed props are better than utility classes here, because the compiler and the editor can both check them. See [ui-scss-modules.md](./ui-scss-modules.md#component-first-architecture).

**Three layers of tokens.** Primitive values feed semantic tokens, and component code references the semantic layer. See [ui-design-token-layers.md](./ui-design-token-layers.md).

**Container queries, not viewport media queries.** A component sizes itself against the container it was placed in, so it works anywhere. See [ui-responsive-design.md](./ui-responsive-design.md).

**Render on the server first.** The server produces the page with real data, then the browser attaches to that markup and subscribes for live updates. See [react.md](../react/react.md#ssr--live-updates-pattern) and [ui-ssr-hydration.md](./ui-ssr-hydration.md).

## Quick Reference

### Layout Components

| Component | Props | Purpose |
|-----------|-------|---------|
| `<Page>` | — | Page-level grid whose gap adapts to the viewport |
| `<PageHeader>` | `title`, `subtitle` | The page title section |
| `<Stack>` | `gap="sm\|md\|lg"`, `direction` | Flex container with a consistent gap |
| `<Grid>` | `gap="sm\|md\|lg"`, `columns="2\|3\|responsive"` | Grid layout |
| `<Section>` | `gap="sm\|md\|lg"` | A content section with standard spacing |

### Common Design Tokens

Component code in a `.module.scss` file references Layer 2 (`semantic-tokens.scss`) and never Layer 1 (`primitives.scss`). Layer 1 exists purely as input to Layer 2 and holds only `--spacing-N`, `--radius-N`, and the raw font-size scale.

Within Layer 2, prefer a token named for the use case when one fits, such as `--card-padding-md` or `--button-gap`, over a token named for its value, such as `--gap-md` or `--radius-md`. That is guidance rather than a rule. Full detail is in [ui-design-token-layers.md](./ui-design-token-layers.md).

| Category | Tokens component code may reference |
|----------|--------------------------------------|
| Colors | `--color-text`, `--color-text-muted`, `--color-primary`, `--color-surface`, `--color-surface-muted`, `--color-border`, `--color-success`, `--color-warning`, `--color-danger` (plus the `--color-*-alpha-*` and `--color-*-text` variants) |
| Gaps | `--gap-2xs/xs/sm/md/lg/xl` for general use, plus the component-scoped `--stack-gap-sm/md/lg`, `--section-gap-sm/md/lg`, `--grid-gap-sm/md/lg`, `--button-gap`, `--badge-gap`, `--chip-gap` |
| Padding | `--padding-2xs/xs/sm/md/lg/xl` for general use, plus the component-scoped `--card-padding-xs/sm/md/lg`, `--button-padding-xs/sm/md/lg`, `--input-padding-xs/sm/md/lg`, `--alert-padding` |
| Typography | `--font-size-caption`, `--font-size-body-sm/body/body-lg`, `--font-size-heading-sm/md/lg/xl`; `--font-weight-normal/medium/semibold/bold`; `--line-height-tight/normal/relaxed` |
| Borders | `--border-width-thin/medium/thick`; `--radius-xs` (4px), `--radius-sm` (10px), `--radius-md` (16px), `--radius-lg` (24px), `--radius-xl` (32px), `--radius-full` (999px, not scaled) |
| Shadows | `--shadow-sm/md/lg` |
| Avatars | `--avatar-size-sm/md/lg` |
| Max widths | `--max-width-prose` (64ch), `--max-width-xs/sm/md/lg/xl` (320–1080px) |
| Breakpoints | `$breakpoint-mobile-sm` (360px), `$breakpoint-mobile-md` (480px), `$breakpoint-mobile-lg` (768px), `$breakpoint-tablet` (1024px), `$breakpoint-desktop` (1200px), `$breakpoint-desktop-lg` (1440px), `$breakpoint-desktop-xl` (1920px); `$breakpoint-mobile` is an alias for `$breakpoint-mobile-lg` (768px) |

### SCSS Module Naming

Use underscores in multi-word class names so TypeScript dot notation works. The last two rows use BEM, a naming convention where a double underscore marks a part of a component and a double hyphen marks a variation of it.

| Pattern | CSS | TypeScript |
|---------|-----|-----------|
| Single word | `.card` | `styles.card` |
| Multi-word | `.market_card` | `styles.market_card` |
| BEM element | `.card__header` | `styles.card__header` |
| BEM modifier | `.card--selected` | `styles['card--selected']` |

### Common UI Primitives

Buttons and badges are React components backed by scoped SCSS Modules, so use `<Button>` and `<Badge>` rather than applying class names by hand. The only global utility class intended for general use is `.text-muted`.

| Pattern | Use |
|---------|-----|
| Button | `<Button>` from `components/ui/Button` (variants `primary/secondary/ghost/danger/warning`; sizes `xs/sm/md/lg`) |
| Badge | `<Badge>` from `components/ui/Badge` (tones `neutral/info/success/warning/danger`) |
| Headline statistic | `<StatGrid>` with `<StatTile>` from `components/ui/StatTile`, using `size="md"` for a page band and `size="sm"` for an admin strip. Never hand-write label and value markup, and do not use the legacy `.stat-grid` or `.stat-card__*` global classes. |
| Labelled or validated field | `<Field>` from `components/ui/Field`, wrapping the control. Owns the label, the `hint`/`error` message, and the `aria-describedby` between them. Set `invalid` on the control itself for the danger border and `aria-invalid` |
| Muted text | The `text-muted` class |

### Icons

Take every icon from `lucide-react`. Use 14px inline, 16px in headings, 18px in buttons, and 24px for a hero element. Always set icon color from a CSS variable rather than a literal value. See [ui-icons-and-feedback.md](./ui-icons-and-feedback.md).

## Pre-Ship Checklist

- [ ] Page structure uses the layout components
- [ ] Every color, spacing value, font, and size comes from a CSS variable
- [ ] Component styles live in a colocated `.module.scss` file using underscore naming
- [ ] Responsive behaviour uses container queries rather than viewport media queries
- [ ] Icons come from `lucide-react` and take their color from design tokens
- [ ] State changes give visual feedback for loading, error, and success
- [ ] Markup is semantic, and icon-only buttons carry an ARIA label so screen readers can announce them
- [ ] Validation messages go through `<Field>` rather than loose markup, so the message is associated with the control
- [ ] Timestamps use `ClientTime` or another two-phase rendering approach
- [ ] Tested as a full page, in a slideout, in a modal, and at mobile width

## Further Reading

**Detail documents:**
- [ui-components.md](./ui-components.md) — full catalog of layout primitives, UI primitives, and context providers, with prop summaries and links to source
- [ui-scss-modules.md](./ui-scss-modules.md) — SCSS architecture, naming conventions, and the component styling workflow
- [ui-responsive-design.md](./ui-responsive-design.md) — container queries, breakpoints, and SCSS interpolation
- [ui-icons-and-feedback.md](./ui-icons-and-feedback.md) — Lucide icons, animations, and feedback for state changes
- [ui-accessibility.md](./ui-accessibility.md) — semantic HTML, ARIA labels, focus management, and plugin styling
- [ui-ssr-hydration.md](./ui-ssr-hydration.md) — preventing hydration errors, `ClientTime`, and two-phase rendering
- [ui-design-token-layers.md](./ui-design-token-layers.md) — the token hierarchy, complete reference, and how it aligns with the W3C design token format
- [ui-theme.md](./ui-theme.md) — the theme system, admin interface, and injection during server rendering

**Related topics:**
- [frontend.md](../frontend.md) — frontend architecture overview
- [frontend-architecture.md](../frontend-architecture.md) — file organization and module patterns
- [react.md](../react/react.md) — React component patterns and SSR + Live Updates
- [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) — what plugins receive, and how they use SCSS Modules
