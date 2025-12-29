# Frontend Component Guide

This guide explains how to style React components in the TronRelic frontend using CSS Modules, design tokens, and the established design system.

## Who This Document Is For

Frontend developers and plugin authors building user interfaces within TronRelic. If you're creating React components, implementing interactive features, or designing plugin pages, these patterns ensure your work integrates seamlessly with the existing design system.

## Why Styling Standards Matter

Inconsistent styling creates problems that compound over time:

- **Visual fragmentation** - Mismatched colors, spacing, and animations make the interface feel unprofessional and disjointed
- **Maintenance burden** - One-off implementations duplicate code and make future refactoring exponentially harder
- **Plugin integration problems** - Plugins that ignore the design system clash visually when loaded into the main application
- **User confusion** - Mixed interaction patterns force users to relearn behaviors across different parts of the application

Following these guidelines eliminates these risks and ensures your interfaces feel like a natural extension of TronRelic.

## SCSS Architecture: Two-Layer System

### ⚠️ SCSS Modules Class Name Conventions

**Why This Convention Matters:**

SCSS Modules in TypeScript generate typed objects that map class names to scoped identifiers. Using underscores for multi-word identifiers ensures you can access styles using clean dot notation (`styles.market_region`) instead of bracket notation (`styles['market-region']`), which is verbose and loses type safety.

**Naming Rules:**

1. **Single-word identifiers**: No separators (e.g., `.market`, `.card`, `.header`)
2. **Multi-word identifiers**: Use underscores (e.g., `.market_region`, `.best_deal`, `.loading_state`)
3. **BEM Element separator**: Keep double underscore `__` (e.g., `.card__header`, `.table__cell`)
4. **BEM Element with multi-word names**: Combine underscores for words + double underscore for hierarchy (e.g., `.table__cell_market`, `.card__header_title`)
5. **BEM Modifier separator**: Keep double hyphen `--` for modifiers (e.g., `.card--selected`, `.table__row--best_deal`)

**Good Examples (Dot Notation):**

```scss
/* MarketTable.module.scss */
.market { ... }                          /* Single word */
.market_region { ... }                   /* Multi-word identifier */
.table__cell { ... }                     /* BEM element */
.table__cell_market { ... }              /* BEM element with multi-word name */
.card--selected { ... }                  /* BEM modifier */
.table__row--best_deal { ... }           /* BEM modifier with multi-word name */
```

```tsx
// MarketTable.tsx - Clean dot notation with type safety
import styles from './MarketTable.module.scss';

<div className={styles.market}>
    <table className={styles.market_region}>
        <td className={styles.table__cell_market}>Data</td>
        <tr className={styles.table__row--best_deal}>Row</tr>
    </table>
</div>
```

**Bad Examples (Hyphens Break Dot Notation):**

```css
/* ❌ Bad - hyphens require bracket notation */
.market-region { ... }
.table-cell { ... }
.best-deal { ... }
```

```tsx
// ❌ Bad - loses type safety and readability
import styles from './MarketTable.module.css';

<div className={styles['market-region']}>
    <td className={styles['table-cell']}>Data</td>
</div>
```

**BEM Pattern Summary:**

| Pattern | Example | TypeScript Access |
|---------|---------|-------------------|
| Block (single word) | `.card` | `styles.card` |
| Block (multi-word) | `.market_card` | `styles.market_card` |
| Element | `.card__header` | `styles.card__header` |
| Element (multi-word) | `.card__header_title` | `styles.card__header_title` |
| Modifier | `.card--selected` | `styles['card--selected']` |
| Modifier (multi-word) | `.card--best_deal` | `styles['card--best_deal']` |

**Note:** Double hyphens (`--`) in BEM modifiers still require bracket notation, but they are less frequently used than base classes and elements. Prioritize underscores for all multi-word identifiers to maximize dot notation usage.

TronRelic separates styling concerns into two distinct layers:

1. **`globals.scss` provides the design foundation** - CSS variables (design tokens), utility classes, base resets, and animations that ensure visual consistency across the entire application
2. **SCSS Modules provide component isolation** - Scoped styles that prevent naming collisions, make ownership clear, and enable safe refactoring without breaking unrelated components

### What Goes in globals.scss

The `globals.scss` file should contain **ONLY** these categories:

1. **CSS Variables (Design Tokens)**
   - Colors: `--color-primary`, `--color-surface`, `--color-border`
   - Typography: `--font-body`
   - Spacing: `--radius-sm`, `--radius-md`, `--radius-lg`
   - Shadows: `--shadow-sm`, `--shadow-md`, `--shadow-lg`
   - Timing: `--transition-base`

2. **Base Resets and Element Defaults**
   - Universal box-sizing rules
   - Body background and font defaults
   - Link color inheritance
   - Semantic element defaults (`main`, `a`, `body`)

3. **Styling Utility Classes**
   - Visual surfaces: `.surface`, `.surface--elevated`, `.surface--padding-md`
   - Interactive elements: `.btn`, `.btn--primary`, `.badge`, `.input`
   - State modifiers: `.text-muted`, `.btn--loading`

4. **Global Animations**
   - Keyframe definitions: `@keyframes rowFlash`, `@keyframes shimmer`
   - Animation classes: `.table-row--flash`, `.surface--flash`

5. **Viewport-Level Responsive Styles**
   - Global layout breakpoints affecting page chrome, navigation, or overall structure
   - Media queries that adjust `.layout-nav`, `main` padding, or other layout shells

**Layout primitives use React components** (`<Page>`, `<Stack>`, `<Grid>`, etc.) instead of CSS classes.

**Everything else belongs in component-specific SCSS Modules.**

### What Goes in SCSS Modules

Component SCSS Modules (`.module.scss` files) should contain:

- **Component-specific class names** - Styles that only apply to one component
- **Component layout** - Grid/flexbox rules specific to the component's internal structure
- **Component states** - Hover, focus, active states unique to the component
- **Component container queries** - Responsive behavior based on container width (not viewport)
- **Component animations** - Transitions or animations used only by this component

## How to Style Components with SCSS Modules

### Step 1: Create the SCSS Module File

Place the SCSS Module file next to your component:

```
components/MarketCard/
├── MarketCard.tsx
└── MarketCard.module.scss
```

**Naming convention:** `ComponentName.module.scss`

### Step 2: Import the Module

Import the module in your component:

```typescript
import styles from './ComponentName.module.scss';
```

### Step 3: Apply Scoped Classes

Use the imported `styles` object to apply scoped class names:

```typescript
<div className={styles.card}>
    <div className={styles.header}>
        <h3 className={styles.title}>{name}</h3>
    </div>
</div>
```

### Step 4: Combine with Utility Classes

Mix CSS Module classes with global utility classes when appropriate:

```typescript
<div className={`surface surface--padding-md ${styles.card}`}>
    <span className="badge badge--success">{status}</span>
    <div className={styles.customLayout}>
        <p className="text-muted">{description}</p>
    </div>
</div>
```

**When to use utilities:**
- Surface backgrounds and borders (`.surface`)
- Button variants (`.btn`, `.btn--primary`)
- Badge states (`.badge`, `.badge--success`)
- Standard layouts (`.stack`, `.grid`)
- Text styling (`.text-muted`)

**When to use SCSS Modules:**
- Custom layouts specific to your component
- Component-specific spacing or sizing
- Unique hover/focus states
- Container queries for component responsiveness
- Responsive media queries using SCSS breakpoint variables

### Step 5: Use CSS Variables for Theming

Always reference design tokens from `semantic-tokens.scss` in your SCSS Module:

```scss
/* MarketCard.module.scss */
@use '../../../app/breakpoints' as *;

.card {
    background: var(--color-surface);
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--spacing-10);
    transition: all var(--transition-base);
}

.title {
    color: var(--color-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
}

/* Use SCSS breakpoint variables in media queries */
@media (max-width: $breakpoint-mobile) {
    .card {
        padding: var(--spacing-7);
    }
}
```

**Never hardcode values:**

```scss
/* ❌ Bad - hardcoded values break consistency and theming */
.card {
    background: rgba(12, 18, 34, 0.88);
    border: 1px solid rgba(120, 180, 255, 0.14);
    border-radius: 16px;
    padding: 1.5rem;  /* Should be var(--spacing-10) */
    color: #4b8cff;
}

.title {
    font-size: 1.2rem;  /* Should be var(--font-size-lg) */
    font-weight: 600;   /* Should be var(--font-weight-semibold) */
}
```

## Complete Example

Here's a full example showing the recommended patterns:

**`components/MarketCard/MarketCard.tsx`**
```typescript
/**
 * Market Card Component
 *
 * Displays energy market provider information with pricing, availability,
 * and reliability metrics. Adapts layout based on container width using
 * container queries.
 *
 * @param props - Component props
 * @param props.name - Provider name
 * @param props.price - Energy price in TRX
 * @param props.availability - Availability status
 */

import styles from './MarketCard.module.scss';

interface MarketCardProps {
    name: string;
    price: number;
    availability: string;
}

export function MarketCard({ name, price, availability }: MarketCardProps) {
    return (
        <div className={`surface surface--padding-md ${styles.card}`}>
            <div className={styles.header}>
                <h3 className={styles.title}>{name}</h3>
                <span className="badge badge--success">{availability}</span>
            </div>
            <div className={styles.price}>
                {price.toLocaleString()} TRX
            </div>
        </div>
    );
}
```

**`components/MarketCard/MarketCard.module.scss`**
```scss
/**
 * Market Card Styles
 *
 * Responsive card layout using container queries to adapt to available space.
 * Combines global .surface utility with component-specific layout and typography.
 * All values use design tokens from semantic-tokens.scss for consistency.
 */

@use '../../../app/breakpoints' as *;

.card {
    container-type: inline-size;
    container-name: market-card;
}

.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-7);
}

.title {
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--color-primary);
}

.price {
    font-size: var(--font-size-2xl);
    font-weight: var(--font-weight-bold);
    color: var(--color-text);
}

/* Container query for responsive behavior */
@container market-card (max-width: 300px) {
    .header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--spacing-4);
    }

    .price {
        font-size: var(--font-size-xl);
    }
}
```

**Key points:**
- `.surface` and `.badge` are utility classes from `globals.scss`
- `.card`, `.header`, `.title`, `.price` are scoped to this component via SCSS Modules
- **All values use design tokens** - spacing (`--spacing-*`), typography (`--font-size-*`, `--font-weight-*`), colors (`--color-*`)
- **Breakpoints imported from `_breakpoints.scss`** - enables SCSS variables in media queries
- Container queries adapt the component to its available space
- JSDoc comments explain the "why" before showing the "how"

## Design System Reference

### Core CSS Variables (Semantic Tokens)

TronRelic uses a **3-layer design token system**. Component styles should reference **semantic tokens** from `semantic-tokens.scss`, which compose primitive values from `primitives.scss`. Breakpoints are defined as SCSS variables in `_breakpoints.scss` for use in media queries.

**Key semantic tokens for component styling:**

| Category | Token | Purpose |
|----------|-------|---------|
| **Colors** | `--color-text` | Primary text color |
| | `--color-text-muted` | Secondary/muted text |
| | `--color-text-subtle` | Tertiary/subtle text |
| | `--color-primary` | Primary brand color |
| | `--color-secondary` | Secondary brand color |
| | `--color-success` | Success state |
| | `--color-warning` | Warning state |
| | `--color-danger` | Error/danger state |
| | `--color-surface` | Card/panel backgrounds |
| | `--color-background` | Page background |
| | `--color-border` | Default borders |
| **Spacing** | `--spacing-1` through `--spacing-20` | Consistent spacing scale (0.25rem to 5rem) |
| **Typography** | `--font-size-xs` through `--font-size-3xl` | Font size scale |
| | `--font-weight-normal`, `--font-weight-medium`, `--font-weight-semibold`, `--font-weight-bold` | Font weights |
| | `--line-height-tight`, `--line-height-normal`, `--line-height-relaxed` | Line heights |
| **Borders** | `--border-width-thin`, `--border-width-medium` | Border widths |
| | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full` | Border radii |
| **Shadows** | `--shadow-sm`, `--shadow-md`, `--shadow-lg` | Elevation shadows |
| **Transitions** | `--transition-base` | Standard transition timing |

**Always use semantic tokens instead of hardcoding values.** This ensures consistency, enables theming, and makes global design updates trivial.

**See [ui-design-token-layers.md](./ui/ui-design-token-layers.md) for complete token reference and usage guidelines.**

### Available Utility Classes

#### Surfaces and Cards

```tsx
// Basic surface
<div className="surface surface--padding-md">
    Content here
</div>

// With variants
<div className="surface surface--muted surface--padding-lg">
    Muted background surface
</div>

<div className="surface surface--accent surface--elevated">
    Accent surface with extra elevation
</div>
```

**Available surface modifiers:**
- `.surface--muted` - Darker background for nested content
- `.surface--accent` - Gradient accent background
- `.surface--elevated` - Larger shadow for prominence
- `.surface--padding-sm`, `.surface--padding-md`, `.surface--padding-lg` - Standard padding sizes

#### Buttons

```tsx
// Primary action button
<button className="btn btn--primary btn--md">
    Submit
</button>

// Secondary action
<button className="btn btn--secondary btn--md">
    Cancel
</button>

// Ghost button for subtle actions
<button className="btn btn--ghost btn--sm">
    Learn More
</button>

// Danger button for destructive actions
<button className="btn btn--danger btn--md">
    Delete
</button>
```

**Button sizes:**
- `.btn--sm` - Compact buttons (34px height)
- `.btn--md` - Standard buttons (42px height)
- `.btn--lg` - Large buttons (50px height)

**Button states:**
- `.btn--loading` - Indicates processing (adds opacity and cursor)
- `:disabled` - Native disabled state (automatically styled)

#### Badges

```tsx
<span className="badge badge--neutral">Active</span>
<span className="badge badge--success">Completed</span>
<span className="badge badge--warning">Pending</span>
<span className="badge badge--danger">Failed</span>
```

#### Forms

```tsx
<input
    type="text"
    className="input"
    placeholder="Enter value"
/>

// Ghost variant for inline editing
<input
    type="text"
    className="input input--ghost"
    placeholder="Search..."
/>
```

#### Layout Components

Layout primitives use React components for TypeScript safety and IDE autocomplete:

```tsx
import { Page, PageHeader, Stack, Grid, Section } from '../../../components/layout';

// Page with header
<Page>
    <PageHeader title="Dashboard" subtitle="Overview of activity" />
    <Section>
        <Card>Content</Card>
    </Section>
</Page>

// Vertical stack with gap
<Stack gap="md">
    <div>Item 1</div>
    <div>Item 2</div>
</Stack>

// Horizontal stack
<Stack direction="horizontal" gap="sm">
    <Button>Action 1</Button>
    <Button>Action 2</Button>
</Stack>

// Responsive grid
<Grid columns="responsive" gap="md">
    <Card>Card 1</Card>
    <Card>Card 2</Card>
</Grid>

// Fixed columns
<Grid columns={3} gap="lg">
    <Card>Col 1</Card>
    <Card>Col 2</Card>
    <Card>Col 3</Card>
</Grid>
```

**Layout Component Reference:**

| Component | Props | Purpose |
|-----------|-------|---------|
| `<Page>` | - | Page-level grid with responsive gap |
| `<PageHeader>` | `title`, `subtitle` | Page title section |
| `<Stack>` | `gap="sm\|md\|lg"`, `direction="vertical\|horizontal"` | Flex container |
| `<Grid>` | `gap="sm\|md\|lg"`, `columns="2\|3\|responsive"` | Grid layout |
| `<Section>` | `gap="sm\|md\|lg"` | Content section with spacing |

## Responsive Design: Container Queries

**Rule: Always use CSS container queries for component-level responsiveness. Reserve viewport media queries exclusively for global layout changes.**

**⚠️ SCSS Variable Gotcha:** Container queries require interpolation `#{$variable}` while media queries don't. Without interpolation, the rule compiles but the condition is silently dropped ([Sass #3471](https://github.com/sass/sass/issues/3471)):

```scss
/* ✅ Works */ @container my-card (max-width: #{$breakpoint-mobile}) { ... }
/* ❌ Fails */ @container my-card (max-width: $breakpoint-mobile) { ... }
/* ✅ Works */ @media (max-width: $breakpoint-mobile) { ... }
```

### Why Container Queries?

Container queries solve a critical problem: **components must adapt to their available space, not the viewport size.**

When you use viewport media queries (`@media (min-width: ...)`) for component styling:

- **Layout collapse** - A component rendered in a narrow sidebar breaks when viewport breakpoints assume full-width
- **Plugin unpredictability** - Plugins loaded into different contexts (cards, modals, slideouts) inherit the wrong responsive rules
- **Reusability problems** - Components tightly coupled to specific page layouts can't be moved without rewriting breakpoint logic

Container queries fix this by letting each component define its own responsive behavior based on its container's width, not the viewport's width.

### How to Use Container Queries

1. **Declare the responsive wrapper as a container:**

```css
.analytics-card {
    container-type: inline-size;
    container-name: analytics-card;
}
```

2. **Scope responsive rules with `@container` instead of `@media`:**

```scss
@use '../../../app/breakpoints' as *;

/* Adapts when the container is narrow, regardless of viewport */
@container analytics-card (min-width: #{$breakpoint-mobile-md}) {
    .analytics-card__grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@container analytics-card (min-width: 720px) {
    .analytics-card__grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
```

3. **Use semantic container names:** Choose descriptive names that match your component's purpose (`market-card`, `transaction-panel`, etc.). Reuse shared names from the design system when appropriate.

4. **Reserve viewport media queries for global chrome only:** Use `@media` exclusively for layout shells (navigation, page structure) defined in `/apps/frontend/app/layout.tsx`.

### Container Query Example

```tsx
// Component: TransactionCard
import './TransactionCard.css';

/**
 * Transaction Card Component
 *
 * Displays transaction details in a responsive grid layout that adapts
 * based on container width, not viewport size. Ensures consistent layout
 * whether rendered full-width, in slideouts, or within plugin contexts.
 *
 * @param props - Component props
 * @param props.transaction - Transaction data to display
 */
export function TransactionCard({ transaction }: { transaction: ITransaction }) {
    return (
        <div className="transaction-card">
            <div className="transaction-card__grid">
                <div className="transaction-card__stat">Hash: {transaction.hash}</div>
                <div className="transaction-card__stat">Amount: {transaction.amount}</div>
                <div className="transaction-card__stat">Status: {transaction.status}</div>
            </div>
        </div>
    );
}
```

```scss
/* TransactionCard.module.scss */
@use '../../../app/breakpoints' as *;

.transaction-card {
    container-type: inline-size;
    container-name: transaction-card;
}

.transaction-card__grid {
    display: grid;
    grid-template-columns: 1fr; /* Single column by default */
    gap: var(--spacing-7);
}

/* When container is 480px+ wide, show 2 columns */
@container transaction-card (min-width: #{$breakpoint-mobile-md}) {
    .transaction-card__grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

/* When container is 720px+ wide, show 3 columns */
@container transaction-card (min-width: 720px) {
    .transaction-card__grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
```

This component adapts correctly whether it's rendered full-width on a page, inside a 45%-width slideout, or within a plugin card.

## Icons: Use Lucide React

**Rule: All icons must come from `lucide-react`. Do not mix icon libraries or use custom SVGs unless absolutely necessary (e.g., brand logos).**

### Why Lucide React?

- **Tree-shakeable** - Only bundles icons you import (~1-2kb per icon)
- **Consistent design** - Single cohesive visual style across all icons
- **TypeScript-first** - Excellent type support and autocomplete
- **Customizable** - Size, color, and strokeWidth as props
- **Modern** - Optimized for React and modern bundlers

### How to Use Lucide Icons

1. **Import only the icons you need:**

```tsx
import { Info, TrendingUp, AlertCircle, ChevronDown } from 'lucide-react';
```

2. **Customize with props:**

```tsx
// Simple icon with size
<Info size={16} />

// With custom color
<TrendingUp size={20} color="#57d48c" />

// With CSS variable (preferred)
<AlertCircle
    size={18}
    style={{ color: 'var(--color-warning)' }}
/>

// With tooltip for accessibility
<Info
    size={14}
    title="Helpful information here"
    style={{ cursor: 'help' }}
/>
```

### Standard Icon Sizes

Use consistent sizes across the application:

| Context | Size | Example |
|---------|------|---------|
| Inline with body text | `14px` | `<Info size={14} />` |
| In headings or labels | `16px` | `<Info size={16} />` |
| In buttons | `18px` | `<Copy size={18} />` |
| Hero/feature icons | `24px` | `<TrendingUp size={24} />` |

### Common Icons Reference

| Icon | Import | Use Case |
|------|--------|----------|
| `Info` | `import { Info } from 'lucide-react'` | Tooltips, help text, info callouts |
| `AlertCircle` | `import { AlertCircle } from 'lucide-react'` | Warnings, alerts |
| `CheckCircle` | `import { CheckCircle } from 'lucide-react'` | Success states |
| `XCircle` | `import { XCircle } from 'lucide-react'` | Errors, close buttons |
| `ChevronDown` | `import { ChevronDown } from 'lucide-react'` | Dropdowns, expandable sections |
| `TrendingUp` | `import { TrendingUp } from 'lucide-react'` | Positive metrics |
| `TrendingDown` | `import { TrendingDown } from 'lucide-react'` | Negative metrics |
| `ExternalLink` | `import { ExternalLink } from 'lucide-react'` | External links |
| `Copy` | `import { Copy } from 'lucide-react'` | Copy-to-clipboard buttons |
| `Search` | `import { Search } from 'lucide-react'` | Search inputs |

Browse the full icon library at [lucide.dev/icons](https://lucide.dev/icons).

### Color Guidelines for Icons

**Always use CSS variables to ensure theme consistency:**

```tsx
// Good - uses design system colors
<Info style={{ color: 'var(--color-text-muted)' }} />
<AlertCircle style={{ color: 'var(--color-warning)' }} />
<CheckCircle style={{ color: 'var(--color-success)' }} />
<XCircle style={{ color: 'var(--color-danger)' }} />

// Acceptable - uses opacity for subtle icons
<Info style={{ opacity: 0.6 }} />

// Bad - hardcoded colors
<Info color="#999" />
```

## Animation and State Feedback

**Always provide visual feedback for state changes using built-in animation classes.**

### Flash Animations

Use flash animations to draw attention to newly added or updated content:

```tsx
// Flash a table row when new data arrives
<tr className="table-row--flash">
    <td>New transaction data</td>
</tr>

// Flash a surface when updated
<div className="surface surface--flash">
    Updated content
</div>
```

### Loading States

Show pending states with visual feedback:

```tsx
// Pending surface (shows dashed border)
<div className="surface surface--pending">
    Content loading...
</div>

// Loading button
<button className="btn btn--primary btn--loading" disabled>
    Processing...
</button>

// Skeleton loader for content
<div className="skeleton" style={{ width: '200px', height: '1.2em' }} />
```

### Error States

Indicate errors visually:

```tsx
// Error surface
<div className="surface surface--error">
    Error loading data
</div>

// Alert message
<div className="alert alert--danger">
    Failed to process transaction
</div>
```

## Accessibility Best Practices

### Semantic HTML

**Use semantic HTML elements instead of generic divs:**

```tsx
// Good - semantic structure
<button onClick={handleClick}>Submit</button>
<nav>
    <ul>
        <li><a href="/markets">Markets</a></li>
    </ul>
</nav>

// Bad - divs with click handlers
<div onClick={handleClick}>Submit</div>
<div>
    <div>
        <div><div onClick={goToMarkets}>Markets</div></div>
    </div>
</div>
```

### Focus Management

**Ensure all interactive elements have visible focus states.** The design system provides focus styles automatically for buttons, inputs, and links.

```tsx
// Focus styles are built-in for these elements
<button className="btn btn--primary">Click Me</button>
<input className="input" />
<a href="/markets">Markets</a>

// For custom interactive elements, ensure focus-visible is styled
<div
    role="button"
    tabIndex={0}
    className="custom-interactive"
    onKeyDown={handleKeyDown}
>
    Custom Element
</div>
```

### ARIA Labels

**Add ARIA labels for icons and interactive elements without visible text:**

```tsx
import { Search, X } from 'lucide-react';

// Search icon with accessible label
<button aria-label="Search markets">
    <Search size={18} />
</button>

// Close button with label
<button
    className="slideout-close"
    onClick={onClose}
    aria-label="Close panel"
>
    <X size={20} />
</button>
```

## Plugin-Specific Considerations

When building plugin UIs, follow these additional rules:

### 1. Use Layout Components for Page Structure

Plugin pages MUST use the `<Page>` layout component for page structure. This provides mobile-responsive gap behavior and consistent page layout:

```tsx
// CORRECT - layout components for page structure
import { Page, PageHeader, Stack } from '../../../components/layout';
import styles from './MyPluginPage.module.scss';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    return (
        <Page>
            <PageHeader title="My Plugin" subtitle="Plugin description" />
            <context.ui.Card>
                <Stack gap="md">
                    <p>Content here</p>
                </Stack>
            </context.ui.Card>
        </Page>
    );
}
```

For plugins that need container queries on the page wrapper, use a module class alongside the Page component:

```tsx
// With container queries for plugin-specific responsiveness
<div className={styles.container}>
    <Page>
        <PageHeader title="My Plugin" />
        <context.ui.Card>...</context.ui.Card>
    </Page>
</div>
```

```scss
/* Module class for container queries */
.container {
    container-type: inline-size;
    container-name: my-plugin-page;
}
```

**Key rules:**
- Use `<Page>` component for page-level layout with responsive gap
- Use `<PageHeader>` for consistent title/subtitle sections
- Use `<Stack>` and `<Grid>` for internal layout
- Add module class wrapper only when container queries are needed

### 2. Always Use Container Queries

Plugins render in various contexts (full pages, cards, modals, slideouts). **Never use viewport media queries** for plugin component styling—always use container queries so your UI adapts to its container.

### 3. Import Design System Variables

Plugins should reference the same CSS variables as the core application:

```tsx
// In plugin component - inline styles (prefer CSS Modules when possible)
<div style={{
    background: 'var(--color-surface)',
    border: 'var(--border-width-thin) solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--spacing-10)'
}}>
    Plugin content
</div>
```

### 4. Use SCSS Modules for Plugin Styles

Create a colocated SCSS Module for plugin-specific styles:

```tsx
// Good - layout components with SCSS Modules for custom styling
import { Page, PageHeader, Stack, Grid } from '../../../components/layout';
import styles from './MyPlugin.module.scss';

<Page>
    <PageHeader title="Plugin Title" subtitle="Description" />
    <Grid columns="responsive" gap="md">
        <div className={`surface ${styles.custom_card}`}>
            <Stack gap="sm">
                <h3>Card Title</h3>
                <p className="text-muted">Card content</p>
            </Stack>
        </div>
    </Grid>
</Page>
```

**`MyPlugin.module.scss`:**
```scss
@use '../../../app/breakpoints' as *;

.custom_card {
    border: var(--border-width-thin) solid var(--color-primary);
    container-type: inline-size;
    container-name: custom-card;
}

@container custom-card (min-width: #{$breakpoint-mobile-md}) {
    .custom_card {
        padding: var(--spacing-12);
    }
}
```

**Avoid - inline styles with hardcoded values:**
```tsx
// ❌ Bad - hardcoded values instead of design tokens
<div style={{
    background: 'rgba(12, 18, 34, 0.88)',  /* Should be var(--color-surface) */
    padding: '1.5rem',                      /* Should be var(--spacing-10) */
    borderRadius: '16px'                    /* Should be var(--radius-lg) */
}}>
    <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem'                       /* Should use <Stack gap="lg"> */
    }}>
        <h2>Plugin Title</h2>
        <p style={{
            color: 'rgba(226, 234, 255, 0.64)' /* Should be var(--color-text-muted) */
        }}>
            Description
        </p>
    </div>
</div>
```

### 5. Test in Multiple Contexts

Verify your plugin UI renders correctly in:
- Full-page view
- Narrow slideout (45% width)
- Modal dialog
- Mobile viewport (< 768px)

## SSR and Hydration

**Prerequisite:** All public-facing components must follow the SSR + Live Updates pattern—render fully on the server with real data (no loading spinners), then hydrate for interactivity. **See [react.md](../react/react.md#ssr--live-updates-pattern) for the complete implementation guide.**

This section covers **hydration error prevention**—ensuring server and client renders match when your component already follows the SSR + Live Updates pattern.

TronRelic uses Next.js with Server-Side Rendering (SSR), where components render twice: once on the server (Node.js) and once on the client (browser). If these two renders produce different HTML, React throws a hydration error that breaks the page.

### Common Hydration Pitfall: Timezone-Dependent Rendering

**Problem:** Dates/times render differently on server (UTC) vs client (user's local timezone):

```tsx
// ❌ Bad - causes hydration mismatch
<td>{new Date(market.lastUpdated).toLocaleTimeString()}</td>
// Server renders: "14:30:00 UTC"
// Client renders: "09:30:00" (CST, UTC-5)
// Result: React hydration error
```

**Solution:** Use the `ClientTime` component for all time/date rendering:

```tsx
// ✅ Good - prevents hydration errors
import { ClientTime } from '../../components/ui/ClientTime';

<td>
  <ClientTime date={market.lastUpdated} format="time" />
</td>
```

The `ClientTime` component renders a placeholder (`—`) during SSR, then shows the actual formatted time after mounting on the client. This ensures server and client HTML match perfectly.

**Available formats:**
- `format="time"` - Time only (e.g., "2:30:15 PM")
- `format="datetime"` - Date and time (e.g., "1/15/2025, 2:30:15 PM")
- `format="date"` - Date only (e.g., "1/15/2025")

### Other Hydration Best Practices

**Avoid browser-only APIs during render:**
```tsx
// ❌ Bad - crashes on server
const isMobile = window.innerWidth < 768;

// ✅ Good - check for browser context
const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

// ✅ Better - use effect hook
const [isMobile, setIsMobile] = useState(false);
useEffect(() => {
  setIsMobile(window.innerWidth < 768);
}, []);
```

**Avoid random values in JSX:**
```tsx
// ❌ Bad - different ID each render
<div id={`tooltip-${Math.random()}`}>

// ✅ Good - stable ID across renders
import { useId } from 'react';
const tooltipId = useId();
<div id={tooltipId}>
```

### Two-Phase Rendering Pattern for Timezone-Sensitive Data

**Problem:** When rendering charts or data that depends on the user's local timezone during SSR, the server renders timestamps in one timezone (UTC) while the client renders them in the user's local timezone. This causes React hydration errors because the HTML output differs between server and client renders.

**Example hydration error:**
```
Warning: Text content did not match. Server: "Oct 14, 02:00 AM" Client: "Oct 13, 09:00 PM"
```

**Why this happens:**
- The server (Node.js) renders with UTC or server timezone
- The client (browser) renders with the user's local timezone
- React detects the mismatch and throws a hydration error
- The page may flash incorrect content or break entirely

**Solution: Use two-phase rendering with timezone-agnostic fallbacks**

The two-phase pattern solves hydration mismatches by rendering timezone-agnostic content initially, then switching to timezone-specific content only after live data flows:

**Phase 1 (Initial render):** Show relative time labels ("Now", "2h ago", "5m ago")
- Server and client produce identical output
- No timezone conversion required
- Prevents hydration mismatch

**Phase 2 (After live data arrives):** Switch to absolute timestamps ("10:31 PM", "Oct 13, 9:00 PM")
- Detect when WebSocket connects and live updates start flowing
- Set a state flag to indicate live data is available
- Conditionally render absolute timestamps only when the flag is true

**Implementation Steps:**

1. **Track live data state:**
```tsx
const [hasReceivedLiveData, setHasReceivedLiveData] = useState(false);
const realtime = useRealtimeStatus();

// Detect when live WebSocket updates start flowing
useEffect(() => {
    if (realtime.label === 'Live' && lastUpdated) {
        setHasReceivedLiveData(true);
    }
}, [realtime.label, lastUpdated]);
```

2. **Render timezone-agnostic labels initially, absolute times after live data flows:**
```tsx
xAxisFormatter={(date) => {
    // Initial render (SSR + first client render): Use relative time
    if (!hasReceivedLiveData) {
        const now = Date.now();
        const diffMs = now - date.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

        if (diffMinutes < 30) return 'Now';
        if (diffHours === 0) return `${diffMinutes}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${Math.floor(diffHours / 24)}d ago`;
    }

    // After live data flows: Show absolute timestamps
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}}
```

**When to use this pattern:**

- **Real-time dashboards** - Charts showing live blockchain data, transaction volumes, network metrics
- **Activity feeds** - Lists of recent events with timestamps
- **Historical data visualizations** - Charts comparing current vs historical data
- **Any component rendering timestamps during SSR** - If your component uses `toLocaleTimeString()`, `toLocaleDateString()`, or timezone-aware formatting

**When NOT to use this pattern:**

- **Client-only components** - If the component uses `'use client'` and only renders after mount, use the `ClientTime` component instead
- **Static timestamps** - Historical data that doesn't update in real-time can use the `ClientTime` component
- **Non-timezone-dependent data** - Data that renders identically on server and client (block numbers, transaction hashes, etc.)

**Example: CurrentBlock Component**

The `CurrentBlock` component (located at `/apps/frontend/features/blockchain/components/CurrentBlock/CurrentBlock.tsx`) demonstrates this pattern:

- Lines 53, 77-81: State tracking for `hasReceivedLiveData` and live data detection
- Lines 243-272: Two-phase rendering in chart axis formatter

**Key implementation details:**
1. Uses `useRealtimeStatus()` to detect when WebSocket connection is live
2. Sets `hasReceivedLiveData` flag when live updates start flowing
3. Conditionally switches from relative time ("2h ago") to absolute time ("10:31 PM")
4. Ensures server and client HTML match during initial hydration

**Alternative: Use ClientTime Component**

For simpler cases where you need to display a single timestamp (not in a chart formatter), use the `ClientTime` component instead:

```tsx
import { ClientTime } from '../../components/ui/ClientTime';

// Renders placeholder during SSR, actual time after mount
<td>
  <ClientTime date={transaction.timestamp} format="time" />
</td>
```

The `ClientTime` component renders a placeholder (`—`) during SSR, then shows the formatted time after mounting on the client. This is simpler than the two-phase pattern but doesn't provide the progressive enhancement of showing relative times first.

## Quick Reference Checklist

Before shipping any UI component or plugin page, verify:

- [ ] **Uses layout components** for page structure (`Page`, `PageHeader`, `Stack`, `Grid`, `Section`)
- [ ] **Uses design tokens exclusively** - No hardcoded colors, spacing, font sizes, or weights
  - [ ] Spacing: `var(--spacing-*)` instead of `1rem`, `10px`, etc.
  - [ ] Colors: `var(--color-*)` instead of `#fff`, `rgba(...)`, etc.
  - [ ] Typography: `var(--font-size-*)`, `var(--font-weight-*)`, `var(--line-height-*)` instead of `1.2rem`, `600`, `1.5`, etc.
  - [ ] Borders: `var(--border-width-*)`, `var(--radius-*)` instead of `1px`, `16px`, etc.
- [ ] Component-specific styles are in a colocated SCSS Module file (`ComponentName.module.scss`)
- [ ] SCSS Module is imported using `import styles from './ComponentName.module.scss'`
- [ ] Breakpoints imported via `@use '../../../app/breakpoints' as *;` when using container queries
- [ ] Uses container queries in SCSS Modules for component-level responsiveness
- [ ] Uses styling utility classes for visual patterns (`.surface`, `.btn`, `.badge`)
- [ ] Uses `lucide-react` for all icons
- [ ] Provides visual feedback for state changes (loading, error, success)
- [ ] Uses semantic HTML (buttons, nav, lists, etc.)
- [ ] Includes ARIA labels for icon buttons and interactive elements
- [ ] Has visible focus states for all interactive elements
- [ ] Uses `ClientTime` component for static timestamps (prevents hydration errors)
- [ ] Uses two-phase rendering pattern for timezone-sensitive real-time data (charts, live feeds)
- [ ] Avoids browser-only APIs (`window`, `document`) during initial render
- [ ] Tested in multiple contexts (full-page, slideout, modal, mobile)
- [ ] JSDoc comments explain the "why" before showing the "how"

## Further Reading

- [Frontend Architecture](./frontend-architecture.md) - File organization and folder structure
- [Design System Colors and Variables](../../apps/frontend/app/globals.scss) - Full reference of CSS variables
- [SCSS Breakpoints](../../apps/frontend/app/_breakpoints.scss) - Single source of truth for breakpoint SCSS variables
- [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react)
- [Icon Browser](https://lucide.dev/icons) - Browse all available icons
- [CSS Container Queries (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Container_Queries)
