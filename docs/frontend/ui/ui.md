# UI System Overview

This document provides a high-level summary of TronRelic's UI styling system and design token architecture. For detailed guidance on specific topics, refer to the specialized documentation linked throughout.

## Who This Document Is For

Frontend developers and plugin authors building user interfaces within TronRelic who need to understand the styling standards, design token system, and component patterns before implementing new features or plugin pages.

## Why These Standards Matter

TronRelic's UI system follows strict architectural patterns that solve specific problems:

- **Design tokens prevent visual fragmentation** - Hardcoded color values and spacing create disjointed interfaces that look unprofessional and break when themes change
- **CSS Modules eliminate naming collisions** - Global styles cause conflicts where changing one component breaks unrelated interfaces across the application
- **Container queries enable plugin flexibility** - Viewport media queries fail when components render in sidebars, modals, or plugin contexts with constrained widths
- **Three-layer token hierarchy enables theming** - Without semantic token layers, theme changes require hunting through dozens of CSS files instead of updating a few token definitions

Following these patterns ensures your work integrates seamlessly with existing interfaces and remains maintainable as the system evolves.

## Core UI Principles

### Two-Layer SCSS Architecture

TronRelic separates styling concerns into two distinct layers to prevent conflicts and duplication:

1. **`globals.scss`** - Design tokens (CSS variables), styling utility classes (`.surface`, `.btn`, `.badge`), base resets, and global animations shared across the entire application
2. **SCSS Modules** - Component-specific styles with scoped class names that prevent naming collisions and make ownership clear

Every component should reference design tokens from `globals.scss` (like `var(--color-primary)` or `var(--spacing-7)`) and implement component-specific layout in colocated `.module.scss` files.

**Critical rule:** Never hardcode colors, spacing, typography, or other design values. Always use CSS variables to ensure consistency and enable theming.

**See [ui-component-styling.md](./ui-component-styling.md) for complete details on:**
- What belongs in `globals.scss` vs SCSS Modules
- How to create and use SCSS Module files with TypeScript-safe naming conventions
- Available styling utility classes for surfaces, buttons, badges, and forms
- Layout components for page structure
- Container queries for responsive component behavior
- Icon usage with `lucide-react`
- Animation and state feedback patterns
- Accessibility best practices with semantic HTML and ARIA labels
- Plugin-specific styling considerations
- SSR hydration patterns for timezone-sensitive data

### Component-First Layout Architecture

TronRelic uses **React components for layout primitives** instead of CSS utility classes. This follows patterns established by major design systems (Chakra UI, Material UI, Ant Design) and provides TypeScript safety, IDE autocomplete, and encapsulated responsive behavior.

**Layout Components** (from `components/layout/`):

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| `<Page>` | Page-level grid layout with responsive gap | - |
| `<PageHeader>` | Title + subtitle section | `title`, `subtitle` |
| `<Stack>` | Vertical/horizontal spacing | `gap`, `direction` |
| `<Grid>` | Responsive grid layout | `gap`, `columns` |
| `<Section>` | Content section with spacing | `gap` |

**Why components over utility classes for layout:**

- **Type safety** - `<Stack gap="md">` catches typos at compile time; `.stack--md` fails silently
- **Encapsulation** - Responsive logic and mobile behavior bundled in component
- **Composition** - Aligns with React's component composition model
- **Discoverability** - Props autocomplete in IDE; no memorizing class names

```tsx
import { Page, PageHeader, Stack, Grid } from '../../../components/layout';
import { Card } from '../../../components/ui/Card';

export default function DashboardPage() {
    return (
        <Page>
            <PageHeader
                title="Dashboard"
                subtitle="Monitor your account activity"
            />
            <Grid columns="responsive">
                <Card>Widget 1</Card>
                <Card>Widget 2</Card>
            </Grid>
        </Page>
    );
}
```

**Styling utility classes** (`.surface`, `.btn`, `.badge`) remain for visual styling concerns that work well as composable modifiers. Layout primitives use React components; visual styling uses utility classes.

### Three-Layer Design Token System

TronRelic implements an industry-standard token hierarchy used by Google (Material Design), Adobe (Spectrum), Shopify (Polaris), and GitHub (Primer). This pattern separates concerns and enables flexible theming without duplicating values:

**Layer 1: Foundation Tokens (Primitives)**
- Raw design values with no semantic meaning (color palette, spacing scale, typography scale)
- Defined in `primitives.scss`
- Examples: `--color-blue-500`, `--spacing-7`, `--font-size-lg`

**Layer 2: Semantic Tokens (Aliases)**
- Context-aware variables that compose foundation tokens with purpose
- Defined in `semantic-tokens.scss`
- Examples: `--button-bg-primary`, `--card-border-radius`, `--modal-backdrop-blur`

**Layer 3: Application Layer (Components + Utility Classes)**
- Layout components for page structure: `<Page>`, `<PageHeader>`, `<Stack>`, `<Grid>`, `<Section>`
- Styling utility classes for visual patterns: `.btn .btn--primary`, `.surface .surface--padding-md`, `.badge .badge--success`
- Components defined in `components/layout/`, utility classes defined in `globals.scss`

**Why this architecture matters:**
- **Single source of truth** - Change button padding once instead of hunting through dozens of files
- **Theme switching without rewrites** - Dark mode becomes token remapping instead of code changes
- **Predictable cascading updates** - Adjust spacing scale once, all dependent tokens inherit automatically
- **Proven at scale** - Used by major design systems managing hundreds of components

**See [ui-design-token-layers.md](./ui/ui-design-token-layers.md) for complete details on:**
- Industry-standard token hierarchy with examples from Material Design, Spectrum, Polaris, and Primer
- Complete token reference for colors, spacing, typography, borders, shadows, and transitions
- Token naming conventions and semantic patterns
- W3C Design Tokens Community Group alignment
- Tooling and automation options (Style Dictionary, Figma Tokens, Theo)
- Migration guide for legacy styles

## Quick Reference

### Creating a New Page

Use layout components for page structure:

```tsx
import { Page, PageHeader, Stack, Grid, Section } from '../../../components/layout';
import { Card } from '../../../components/ui/Card';

export default function MyPage() {
    return (
        <Page>
            <PageHeader
                title="Page Title"
                subtitle="Brief description of the page"
            />
            <Section>
                <Grid columns="responsive">
                    <Card>Content 1</Card>
                    <Card>Content 2</Card>
                </Grid>
            </Section>
        </Page>
    );
}
```

### Layout Component Reference

| Component | Props | Purpose |
|-----------|-------|---------|
| `<Page>` | - | Page-level grid with responsive gap |
| `<PageHeader>` | `title`, `subtitle` | Page title section |
| `<Stack>` | `gap="sm\|md\|lg"`, `direction="vertical\|horizontal"` | Flex container with gap |
| `<Grid>` | `gap="sm\|md\|lg"`, `columns="2\|3\|responsive"` | Grid layout |
| `<Section>` | `gap="sm\|md\|lg"` | Content section with spacing |

### Creating a New Component with Styling

1. **Create component folder with SCSS Module:**
   ```
   features/my-feature/components/MyComponent/
   ├── MyComponent.tsx
   ├── MyComponent.module.scss
   └── index.ts
   ```

2. **Import SCSS Module and layout components:**
   ```typescript
   import { Stack } from '../../../components/layout';
   import styles from './MyComponent.module.scss';
   ```

3. **Use design tokens in SCSS Module:**
   ```scss
   /* MyComponent.module.scss */
   @use '../../../app/breakpoints' as *;

   .card {
       background: var(--color-surface);
       border: var(--border-width-thin) solid var(--color-border);
       border-radius: var(--radius-md);
       padding: var(--spacing-10);
   }
   ```

4. **Combine layout components with styling utilities:**
   ```typescript
   <Stack gap="md">
       <div className={`surface ${styles.card}`}>
           <button className="btn btn--primary btn--md">
               Submit
           </button>
       </div>
   </Stack>
   ```

5. **Use container queries for responsiveness:**
   ```scss
   @use '../../../app/breakpoints' as *;

   .card {
       container-type: inline-size;
       container-name: my-card;
   }

   @container my-card (min-width: #{$breakpoint-mobile-md}) {
       .content { grid-template-columns: repeat(2, 1fr); }
   }
   ```

### SCSS Module Naming Conventions

**Critical for TypeScript type safety:** Use underscores for multi-word identifiers to enable clean dot notation (`styles.market_card`) instead of bracket notation (`styles['market-card']`).

| Pattern | CSS Class | TypeScript Access |
|---------|-----------|-------------------|
| Single word | `.card` | `styles.card` |
| Multi-word | `.market_card` | `styles.market_card` |
| BEM element | `.card__header` | `styles.card__header` |
| BEM element (multi-word) | `.card__header_title` | `styles.card__header_title` |
| BEM modifier | `.card--selected` | `styles['card--selected']` |

### Common Design Tokens

| Category | Token Examples | Purpose |
|----------|---------------|---------|
| **Colors** | `--color-text`, `--color-primary`, `--color-surface`, `--color-border` | Text, backgrounds, borders |
| **Spacing** | `--spacing-1` through `--spacing-20` | Consistent spacing scale (0.25rem to 5rem) |
| **Typography** | `--font-size-xs` through `--font-size-3xl`, `--font-weight-semibold` | Font sizes and weights |
| **Borders** | `--border-width-thin`, `--radius-sm`, `--radius-md`, `--radius-lg` | Border widths and radii |
| **Shadows** | `--shadow-sm`, `--shadow-md`, `--shadow-lg` | Elevation shadows |
| **Transitions** | `--transition-base` | Standard timing |
| **Breakpoints** | `$breakpoint-mobile-sm` (360px), `$breakpoint-mobile-md` (480px), `$breakpoint-mobile-lg` (768px), `$breakpoint-tablet` (1024px), `$breakpoint-desktop` (1200px) | Asia-optimized SCSS variables (import `_breakpoints.scss`) |

### Common Styling Utilities

| Pattern | Class | Example |
|---------|-------|---------|
| Surface background | `.surface` | `<div className="surface surface--padding-md">` |
| Primary button | `.btn .btn--primary` | `<button className="btn btn--primary btn--md">` |
| Status badge | `.badge .badge--success` | `<span className="badge badge--success">` |
| Muted text | `.text-muted` | `<p className="text-muted">Secondary text</p>` |
| Inline link | `.link` | `<a href="..." className="link">Read more</a>` |

### Icons with Lucide React

**Rule:** All icons must come from `lucide-react` for consistency.

```typescript
import { Info, TrendingUp, AlertCircle } from 'lucide-react';

// Simple icon with size
<Info size={16} />

// With design system color
<AlertCircle size={18} style={{ color: 'var(--color-warning)' }} />
```

**Standard sizes:** `14px` (inline text), `16px` (headings), `18px` (buttons), `24px` (hero icons)

### Responsive Design Pattern

**Critical rule:** Always use container queries for component-level responsiveness. Reserve viewport media queries exclusively for global layout changes in `app/layout.tsx`.

```scss
@use '../../../app/breakpoints' as *;

/* Component adapts to its container width, not viewport */
.analytics_card {
    container-type: inline-size;
    container-name: analytics-card;
}

@container analytics-card (min-width: #{$breakpoint-mobile-md}) {
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

### SSR + Live Updates Pattern

**All public-facing components must render fully on the server with real data.** Server components fetch data and pass it to client components, which initialize state from props (not empty arrays). This eliminates loading spinners and ensures users see content immediately.

**See [react.md](../react/react.md#ssr--live-updates-pattern) for the complete SSR + Live Updates implementation guide.**

### SSR Hydration for Timezone-Sensitive Data

When components follow the SSR + Live Updates pattern, timezone-sensitive data (dates, times) can cause hydration mismatches because server and client render different output.

**Solution 1 - Static timestamps:** Use `ClientTime` component for simple timestamp display.

```typescript
import { ClientTime } from '../../components/ui/ClientTime';

<td>
    <ClientTime date={transaction.timestamp} format="time" />
</td>
```

**Solution 2 - Real-time data:** Use two-phase rendering pattern that shows relative time initially ("2h ago") then switches to absolute time ("10:31 PM") after live data flows.

**See [ui-component-styling.md](./ui-component-styling.md#ssr-and-hydration) for complete hydration guidance** including the `ClientTime` component, two-phase rendering pattern, and additional best practices.

## Pre-Ship Checklist

Before committing any UI component or plugin page, verify:

- [ ] Uses layout components (`Page`, `PageHeader`, `Stack`, `Grid`, `Section`) for page structure
- [ ] Uses CSS variables from `globals.scss` (no hardcoded colors, spacing, fonts, or sizes)
  - [ ] Spacing: `var(--spacing-*)` not `1rem`, `10px`, etc.
  - [ ] Colors: `var(--color-*)` not `#fff`, `rgba(...)`, etc.
  - [ ] Typography: `var(--font-size-*)`, `var(--font-weight-*)` not `1.2rem`, `600`, etc.
  - [ ] Borders: `var(--border-width-*)`, `var(--radius-*)` not `1px`, `16px`, etc.
- [ ] Component-specific styles are in colocated SCSS Module file (`ComponentName.module.scss`)
- [ ] SCSS Module uses underscore naming for multi-word identifiers (enables dot notation)
- [ ] Uses container queries for component-level responsiveness (not viewport media queries)
- [ ] Uses styling utility classes for visual patterns (`.surface`, `.btn`, `.badge`)
- [ ] Uses `lucide-react` for all icons with design system colors
- [ ] Provides visual feedback for state changes (loading, error, success)
- [ ] Uses semantic HTML (buttons, nav, lists, not generic divs)
- [ ] Includes ARIA labels for icon buttons and interactive elements
- [ ] Has visible focus states for all interactive elements (automatically provided by design system)
- [ ] Uses `ClientTime` component for static timestamps or two-phase rendering for real-time data
- [ ] Avoids browser-only APIs during initial render (check for `window`, `document` usage)
- [ ] Tested in multiple contexts (full-page, slideout, modal, mobile viewport)
- [ ] JSDoc comments explain the "why" before showing the "how"

## Further Reading

**Detailed documentation:**
- [ui-component-styling.md](./ui/ui-component-styling.md) - Complete styling guide with CSS Modules, utility classes, container queries, icons, animations, accessibility, and SSR patterns
- [ui-design-token-layers.md](./ui/ui-design-token-layers.md) - Industry-standard token hierarchy, complete token reference, W3C alignment, and tooling options

**Related topics:**
- [frontend-architecture.md](./frontend-architecture.md) - Feature-based organization, file structure, and import patterns
- [frontend.md](./frontend.md) - Frontend system overview and architectural principles
- [plugins-page-registration.md](../plugins/plugins-page-registration.md) - How plugins register frontend pages with styling
- [plugins-frontend-context.md](../plugins/plugins-frontend-context.md) - Plugin frontend context and CSS Modules usage
- [documentation.md](../documentation.md) - Documentation standards and writing style

**Source files:**
- [apps/frontend/app/primitives.scss](../../../apps/frontend/app/primitives.scss) - Foundation tokens (Layer 1)
- [apps/frontend/app/semantic-tokens.scss](../../../apps/frontend/app/semantic-tokens.scss) - Semantic tokens (Layer 2)
- [apps/frontend/app/globals.scss](../../../apps/frontend/app/globals.scss) - Utility classes and global styles (Layer 3)
- [apps/frontend/app/_breakpoints.scss](../../../apps/frontend/app/_breakpoints.scss) - SCSS breakpoint variables (single source of truth)

**External resources:**
- [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react) - Icon library usage
- [Lucide Icon Browser](https://lucide.dev/icons) - Browse all available icons
- [CSS Container Queries (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Container_Queries) - Container query syntax reference
- [Material Design Tokens](https://m3.material.io/foundations/design-tokens/overview) - Industry token patterns
- [W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/) - Token specification