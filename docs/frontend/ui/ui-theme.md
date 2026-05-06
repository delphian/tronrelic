# Theme System

TronRelic's theme system lets administrators create custom CSS that overrides design tokens at runtime. Themes persist in MongoDB, cache in Redis, and apply via SSR injection with client-side switching.

## Why This Matters

Customizing the application's appearance without a theme system means modifying source files — every update fragments and breaks. The theme system makes brand customization, multiple visual variants, and user-selectable appearance into runtime config. Skipping it scatters hardcoded overrides across the codebase that survive nothing.

## How Themes Work

### CSS Cascade via the data-theme Attribute

Default tokens live on `:root` in `semantic-tokens.scss`. A theme wraps its overrides in `[data-theme="UUID"]`, which beats `:root` on specificity. The root layout sets the attribute on `<html>`, and every component consuming `var(--token-name)` automatically receives the themed value.

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

### SSR Injection

The root layout fetches active themes from `/api/system/themes/active`, reads the user's selected theme ID from the `theme` cookie, injects only the selected theme's CSS into `<head>`, and sets `data-theme` on `<html>` — all during SSR. Users see the right theme on first paint, no flash, no repaint after hydration. The `ThemeToggle` component takes over for client-side switching.

### Dependency Resolution

Themes can depend on other themes (base + variant composition). The backend topologically sorts them so dependencies load before dependents. Circular dependencies throw on activation.

### Selector Normalization

Even if you copy CSS from another theme — `[data-theme="someone-elses-uuid"] { ... }` — the backend normalizes the selector to match the saving theme's UUID. Copy-paste between themes works.

## Creating Themes

### Admin Interface

Navigate to `/system/theme`. The "New" button auto-generates a complete CSS template containing every available CSS variable, organized by section, by reading `primitives.css` and `semantic-tokens.css`. The page also offers icon selection, syntax-validated CSS editor, dependency selection, and an active toggle.

```css
[data-theme="your-theme-uuid"] {
    /* Override only tokens you need to change */
    --color-primary: #ff6b35;
    --body-bg-image: url('/images/custom-background.svg');
    --card-bg-image: url('/images/card-decoration.svg');
}
```

Override only what you need — defaults apply for everything else.

### Workflow

1. Navigate to `/system/theme`
2. Click "New" — the editor populates with the full token template
3. Set a theme name and pick a Lucide icon for the toggle
4. Edit the CSS variables you want to change
5. Optionally select dependency themes that load first
6. Toggle "Enable theme immediately" if desired
7. Save

### What Tokens Can a Theme Override?

Any CSS custom property in the design system. The complete catalog is the source — browse [primitives.scss](../../../src/frontend/app/primitives.scss) (foundation values) and [semantic-tokens.scss](../../../src/frontend/app/semantic-tokens.scss) (use-case-named aliases). The admin's auto-generated template contains them all. For the conceptual hierarchy, see [ui-design-token-layers.md](./ui-design-token-layers.md).

**Note on tier rules:** Component CSS forbids reaching into foundation primitives like `--spacing-*` or raw `--font-size-xs/sm/md/lg/xl/2xl/3xl`. Themes are different — they *are* the remap layer, so overriding primitives is legitimate when a theme needs to shift the foundation scale. The component-code restriction does not apply inside `[data-theme="..."]` blocks.

## Background Image System

The theme system exposes seven background image layers — the most theme-specific surfaces in the design. Each layer has companion tokens (`-opacity`, `-size`, `-position`; the body layer additionally exposes `-repeat` and `-attachment`).

| Token | Applies To | Default |
|-------|-----------|---------|
| `--body-bg-image` | Site-wide, fixed behind all content | `none` |
| `--page-bg-image` | `<Page>` layout component | `none` |
| `--page-header-bg-image` | `<PageHeader>` component | `none` |
| `--card-bg-image` | `<Card>` component | `none` |
| `--stack-bg-image` | `<Stack>` layout component | `none` |
| `--grid-bg-image` | `<Grid>` layout component | `none` |
| `--section-bg-image` | `<Section>` layout component | `none` |

| Suffix | Purpose | Example Values |
|--------|---------|----------------|
| `-opacity` | Transparency (0 = invisible, 1 = solid) | `0.08` |
| `-size` | Image dimensions | `140px`, `cover`, `contain` |
| `-position` | Placement within container | `bottom right`, `center` |
| `-repeat` | Tiling (body layer only) | `no-repeat`, `repeat` |
| `-attachment` | Scroll behavior (body layer only) | `fixed`, `scroll` |

Layout components also accept the `noBackgroundImage` prop to opt specific instances out:

```tsx
<Page noBackgroundImage>
    <Card noBackgroundImage>Content</Card>
</Page>
```

**Asset format:** SVG for logos and decorations (scalable, tiny); optimized PNG/WebP for textures. Upload to `/public/images/` or use absolute URLs.

## Theme Toggle Component

`ThemeToggle` renders one button per active theme in the site header. Each button shows the theme's Lucide icon with an active indicator when selected. Clicking an inactive theme activates it; clicking the active theme reverts to defaults. Selection persists in the `theme` cookie for one year. The component follows the SSR + Live Updates pattern — initial themes arrive from the server, no loading state.

## Plugin Compatibility

Plugins consume the same tokens, so any `var(--color-primary)` in a plugin component automatically receives the themed value. Plugin CSS must use design tokens (never hardcoded values) and avoid `!important` — both break theme overrides. Test new themes against all enabled plugins.

## Assets to Prepare

Before creating a theme, gather:

1. **Brand colors** — primary, secondary, and accent in hex
2. **Logo variations** — SVG, simple single-color works best as watermark
3. **Background textures** (optional) — keep subtle, high opacity competes with content
4. **Toggle icon** — Lucide icon name (browse at lucide.dev/icons)

## Design Considerations

**Plugin coverage** — Plugins consume the same tokens. Test the theme against every enabled plugin before activating: a contrast that works in core might fail in a plugin.

**Interactive states** — Changing `--color-primary` cascades to links, focus rings, active states, hover states. Verify those, not just static screens.

**Subtle backgrounds** — `-opacity` between 0.06 and 0.10 adds visual interest without competing with content; higher values pull the eye off data.

## Further Reading

**Detail docs:**
- [ui-design-token-layers.md](./ui-design-token-layers.md) — Token hierarchy, the 4-tier rule, breakpoints
- [ui-components.md](./ui-components.md) — Components that consume design tokens
- [ui-scss-modules.md](./ui-scss-modules.md) — How component CSS Modules reference tokens

**Source files:**
- [primitives.scss](../../../src/frontend/app/primitives.scss) — Foundation primitives
- [semantic-tokens.scss](../../../src/frontend/app/semantic-tokens.scss) — Semantic + curated tokens
- [components/ui/](../../../src/frontend/components/ui/) — UI primitives
- [components/layout/](../../../src/frontend/components/layout/) — Layout primitives

**Related:**
- [react.md](../react/react.md) — SSR + Live Updates pattern (used by ThemeToggle)
- [modules.md](../../system/modules/modules.md) — Backend module architecture (ThemeModule)
