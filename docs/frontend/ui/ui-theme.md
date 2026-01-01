# Theme System

TronRelic's theme system enables administrators to create, manage, and apply custom CSS themes that override the application's design tokens. Themes persist in MongoDB, cache in Redis, and apply via SSR injection with client-side switching.

## Who This Document Is For

Frontend developers creating custom themes, administrators managing themes through the admin interface, and plugin authors ensuring their components respond correctly to theme changes.

## Why This Matters

The design token system (see [ui-design-token-layers.md](./ui-design-token-layers.md)) establishes TronRelic's visual foundation through CSS custom properties. Without a theme system, customizing the application's appearance would require modifying source files—breaking on every update and fragmenting the codebase.

The theme system solves this by allowing CSS variable overrides that persist in the database and apply at runtime. Themes enable brand customization without source code changes, multiple visual variants for different contexts, and user-selectable appearance preferences. Ignoring this pattern leads to hardcoded style overrides scattered through the codebase that break during application updates.

## How Themes Work

### CSS Cascade via data-theme Attribute

Themes use CSS specificity to override design tokens. The application's default tokens are defined on `:root` in `semantic-tokens.scss`. Theme overrides wrap in a `[data-theme="UUID"]` selector, which has higher specificity than `:root`. When the `data-theme` attribute is set on `<html>`, the browser's CSS cascade applies the theme's values. All components consuming design tokens automatically receive the themed values.

```css
/* Default in semantic-tokens.scss */
:root {
    --color-primary: #4b8cff;
}

/* Theme override stored in database */
[data-theme="a1b2c3d4-..."] {
    --color-primary: #ff6b35;
}
```

### Server-Side Rendering

Themes apply during SSR to prevent flash of unstyled content. The root layout fetches active themes from `/api/system/themes/active`, reads the user's selected theme ID from the `theme` cookie, injects only the selected theme's CSS into `<head>`, and sets the `data-theme` attribute on `<html>`. After hydration, the ThemeToggle component enables client-side switching. Users see the correct theme immediately with no repaint.

### Dependency Resolution

Themes can depend on other themes, enabling composition patterns like base themes with variant extensions. The backend performs topological sort to determine load order—dependencies load before dependents. Circular dependencies throw errors during activation.

## Creating Themes

### Admin Interface

Navigate to `/system/theme` to access theme management. The admin page provides a theme list with active/inactive status, a "New" button that auto-generates a complete CSS template containing all design tokens, icon selection for the theme toggle button, a CSS editor with syntax validation, dependency selection, and an active toggle.

When creating a new theme, the interface fetches `primitives.css` and `semantic-tokens.css` and generates a template containing every CSS variable organized by section. You see all available tokens without hunting through source files.

### Theme CSS Structure

Every theme wraps overrides in the `[data-theme="UUID"]` selector. The backend normalizes CSS to ensure the selector matches the theme's UUID—even if you copy CSS from another theme, the selector corrects automatically on save.

```css
[data-theme="your-theme-uuid"] {
    /* Override only tokens you need to change */
    --color-primary: #ff6b35;
    --body-bg-image: url('/images/custom-background.svg');
    --card-bg-image: url('/images/card-decoration.svg');
}
```

Override only tokens you need—defaults apply automatically. Use CSS validation (built into admin UI) before saving.

### Overridable Token Categories

| Category | Example Tokens | Purpose |
|----------|---------------|---------|
| Colors | `--color-primary`, `--color-surface`, `--color-text` | Brand colors, surfaces |
| Buttons | `--button-primary-background`, `--button-primary-color` | Button variants |
| Cards | `--card-background`, `--card-bg-image`, `--card-border` | Card appearance |
| Layout | `--body-bg-image`, `--page-bg-image`, `--grid-bg-image` | Background images |
| Typography | `--font-size-*`, `--font-weight-*` | Text sizing |

See [primitives.scss](../../../apps/frontend/app/primitives.scss) and [semantic-tokens.scss](../../../apps/frontend/app/semantic-tokens.scss) for complete token references.

## Theme Toggle Component

The `ThemeToggle` component renders one button per active theme in the site header. Each button displays the theme's Lucide icon with an active indicator when selected. Clicking an inactive theme activates it; clicking the active theme returns to defaults. Theme preference persists in the `theme` cookie for one year.

The component follows the SSR + Live Updates pattern: initial themes arrive from the server for immediate rendering without loading states.

## Plugin Compatibility

Plugins consuming design tokens automatically respond to theme changes. When a theme overrides `--color-primary`, every plugin component using `var(--color-primary)` receives the new value. Plugin CSS should use design token variables (never hardcoded values), test with multiple themes, and avoid `!important` declarations that prevent overrides.

## Quick Reference

### Creating a New Theme

1. Navigate to `/system/theme`
2. Click "New" (generates complete CSS template)
3. Change the theme name and select a Lucide icon
4. Modify CSS variables to customize appearance
5. Optionally select dependencies (themes that load first)
6. Toggle "Enable theme immediately" if desired
7. Click "Save Theme"

### Disabling Background Images

Layout components support the `noBackgroundImage` prop to disable background images for specific instances:

```tsx
<Page noBackgroundImage>
    <Card noBackgroundImage>Content</Card>
</Page>
```

## Theme Design Reference

This section catalogs the design surfaces available for theming—tokens, components, and assets you'll need to create a cohesive visual identity.

**Explore the source files.** This guide covers the most common tokens, but the complete design system contains hundreds of variables. Browse `primitives.scss` and `semantic-tokens.scss` directly to discover all available options. Inspect React components in `components/ui/` and `components/layout/` to understand how they consume tokens. The admin interface generates a complete template, but understanding the source reveals possibilities this guide doesn't cover.

### Color System

The color palette forms the foundation. Primary colors affect interactive elements; surface colors define backgrounds and containers; semantic colors communicate meaning.

| Token | Controls | Default |
|-------|----------|---------|
| `--color-primary` | Buttons, links, active states | `#4b8cff` |
| `--color-primary-hover` | Hover states for primary elements | Lighter variant |
| `--color-background` | Page background | `#03060f` |
| `--color-surface` | Cards, panels, overlays | `rgba(12, 18, 34, 0.88)` |
| `--color-text` | Primary text | `#d4d8e8` |
| `--color-text-muted` | Secondary text, labels | `#7a8299` |
| `--color-border` | Borders, dividers | `rgba(255, 255, 255, 0.06)` |
| `--color-success` | Success states, positive values | Green |
| `--color-warning` | Warning states, caution indicators | Amber |
| `--color-danger` | Error states, destructive actions | Red |

### Background Image System

Six background image layers allow branded watermarks, textures, or decorative elements at different UI levels.

| Token | Applies To | Default |
|-------|-----------|---------|
| `--body-bg-image` | Site-wide, fixed behind all content | `none` |
| `--page-bg-image` | `<Page>` layout component | `none` |
| `--page-header-bg-image` | `<PageHeader>` component | `none` |
| `--card-bg-image` | `<Card>` component | `none` |
| `--stack-bg-image` | `<Stack>` layout component | `none` |
| `--grid-bg-image` | `<Grid>` layout component | `none` |
| `--section-bg-image` | `<Section>` layout component | `none` |

Each image layer has companion tokens for fine control:

| Suffix | Purpose | Example Values |
|--------|---------|----------------|
| `-opacity` | Transparency (0 = invisible, 1 = solid) | `0.08` |
| `-size` | Image dimensions | `140px`, `cover`, `contain` |
| `-position` | Placement within container | `bottom right`, `center` |
| `-repeat` | Tiling behavior (body only) | `no-repeat`, `repeat` |
| `-attachment` | Scroll behavior (body only) | `fixed`, `scroll` |

**Asset requirements:** Background images should be SVG format for logos and icons (scalable, small file size) or optimized PNG/WebP for textures. Upload to `/public/images/` or use absolute URLs.

### Themeable Components

These React components consume design tokens and respond to theme changes:

**Layout Components** (`components/layout/`):
- `<Page>` — Page-level container with gap spacing
- `<PageHeader>` — Title/subtitle section with optional actions
- `<Stack>` — Vertical/horizontal flex layout
- `<Grid>` — Responsive grid layout
- `<Section>` — Content grouping with spacing

**UI Components** (`components/ui/`):
- `<Card>` — Content container with surface styling
- `<Button>` — Interactive buttons (primary, secondary, ghost, danger variants)
- `<Badge>` — Status indicators and labels
- `<Input>` — Form text inputs
- `<Modal>` — Dialog overlays

Explore these component directories to see their SCSS modules and understand which tokens they consume. Component styles reveal theming opportunities not listed here.

### Button Token Reference

Buttons have the most extensive token set for fine-grained control:

| Token | Controls |
|-------|----------|
| `--button-primary-background` | Primary button fill (supports gradients) |
| `--button-primary-color` | Primary button text color |
| `--button-primary-shadow` | Primary button drop shadow |
| `--button-primary-border` | Primary button border |
| `--button-secondary-*` | Secondary variant (same suffixes) |
| `--button-ghost-*` | Ghost variant (transparent background) |
| `--button-danger-*` | Danger variant (destructive actions) |
| `--button-border-radius` | Corner rounding (default: pill shape) |
| `--button-height-sm/md/lg` | Size variant heights |
| `--button-padding-sm/md/lg` | Size variant padding |

### Card Token Reference

Cards define the primary content container appearance:

| Token | Controls |
|-------|----------|
| `--card-background` | Surface fill color |
| `--card-border` | Border style and color |
| `--card-border-radius` | Corner rounding |
| `--card-shadow` | Drop shadow |
| `--card-padding-sm/md/lg` | Internal spacing variants |
| `--card-bg-image` | Watermark/decoration image |
| `--card-bg-size` | Image dimensions |
| `--card-bg-opacity` | Image transparency |

### Typography Tokens

Font sizing and weight control text hierarchy:

| Token | Default | Usage |
|-------|---------|-------|
| `--font-size-xs` | `0.72rem` | Table headers, tiny labels |
| `--font-size-sm` | `0.85rem` | Secondary text, captions |
| `--font-size-base` | `0.95rem` | Body text, buttons |
| `--font-size-lg` | `1.05rem` | Large buttons |
| `--font-size-xl` | `1.6rem` | Stat values, emphasis |
| `--font-size-2xl` | `1.8rem` | Page titles (min) |
| `--font-size-3xl` | `2.6rem` | Page titles (max) |
| `--font-weight-normal` | `400` | Body text |
| `--font-weight-semibold` | `600` | Buttons, labels |
| `--font-weight-bold` | `700` | Headings |

### Spacing Scale

Consistent spacing maintains visual rhythm. Override sparingly—changing the scale affects the entire application proportionally.

| Token | Value | Common Usage |
|-------|-------|--------------|
| `--spacing-4` | `0.5rem` | Tight gaps, icon spacing |
| `--spacing-7` | `1rem` | Default stack gap |
| `--spacing-10` | `1.5rem` | Card padding, grid gaps |
| `--spacing-14` | `2.5rem` | Page-level gaps |

### Assets to Prepare

Before creating a theme, gather:

1. **Brand colors** — Primary, secondary, and accent colors in hex format
2. **Logo variations** — SVG format, suitable for watermark use (simple, single-color works best)
3. **Background textures** — Optional patterns or gradients (keep subtle; high opacity competes with content)
4. **Icon** — Choose a Lucide icon name for the theme toggle button (browse at lucide.dev/icons)

### Design Considerations

**Contrast ratios:** Ensure text remains readable against your surface colors. WCAG recommends 4.5:1 minimum for body text, 3:1 for large text.

**Cognitive load:** Subtle backgrounds (0.06-0.10 opacity) add visual interest without competing with content. Higher opacity draws attention away from data.

**Consistency:** If you change `--color-primary`, related elements (links, focus rings, active states) update automatically. Test interactive states, not just static appearance.

**Plugin compatibility:** Plugins consume the same tokens. Test your theme with all enabled plugins to ensure visibility and contrast work throughout.

## Further Reading

**Detailed documentation:**
- [ui-design-token-layers.md](./ui-design-token-layers.md) - Complete token hierarchy and naming conventions
- [ui-component-styling.md](./ui-component-styling.md) - Component styling patterns using design tokens

**Source files to explore:**
- [primitives.scss](../../../apps/frontend/app/primitives.scss) - All foundation tokens (colors, spacing, typography)
- [semantic-tokens.scss](../../../apps/frontend/app/semantic-tokens.scss) - Component-level tokens with context
- [components/ui/](../../../apps/frontend/components/ui/) - UI component implementations
- [components/layout/](../../../apps/frontend/components/layout/) - Layout component implementations

**Related topics:**
- [react.md](../react/react.md) - SSR + Live Updates pattern used by ThemeToggle
- [system-modules.md](../../system/system-modules.md) - Backend module architecture (ThemeModule follows this pattern)
