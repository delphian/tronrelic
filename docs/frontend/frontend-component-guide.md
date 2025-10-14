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

## CSS Architecture: Two-Layer System

### ⚠️ CSS Modules Class Name Conventions

**Why This Convention Matters:**

CSS Modules in TypeScript generate typed objects that map class names to scoped identifiers. Using underscores for multi-word identifiers ensures you can access styles using clean dot notation (`styles.market_region`) instead of bracket notation (`styles['market-region']`), which is verbose and loses type safety.

**Naming Rules:**

1. **Single-word identifiers**: No separators (e.g., `.market`, `.card`, `.header`)
2. **Multi-word identifiers**: Use underscores (e.g., `.market_region`, `.best_deal`, `.loading_state`)
3. **BEM Element separator**: Keep double underscore `__` (e.g., `.card__header`, `.table__cell`)
4. **BEM Element with multi-word names**: Combine underscores for words + double underscore for hierarchy (e.g., `.table__cell_market`, `.card__header_title`)
5. **BEM Modifier separator**: Keep double hyphen `--` for modifiers (e.g., `.card--selected`, `.table__row--best_deal`)

**Good Examples (Dot Notation):**

```css
/* MarketTable.module.css */
.market { ... }                          /* Single word */
.market_region { ... }                   /* Multi-word identifier */
.table__cell { ... }                     /* BEM element */
.table__cell_market { ... }              /* BEM element with multi-word name */
.card--selected { ... }                  /* BEM modifier */
.table__row--best_deal { ... }           /* BEM modifier with multi-word name */
```

```tsx
// MarketTable.tsx - Clean dot notation with type safety
import styles from './MarketTable.module.css';

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

1. **`globals.css` provides the design foundation** - CSS variables (design tokens), utility classes, base resets, and animations that ensure visual consistency across the entire application
2. **CSS Modules provide component isolation** - Scoped styles that prevent naming collisions, make ownership clear, and enable safe refactoring without breaking unrelated components

### What Goes in globals.css

The `globals.css` file should contain **ONLY** these categories:

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

3. **Utility Classes**
   - Layout primitives: `.stack`, `.grid`, `.page`
   - Reusable components: `.surface`, `.btn`, `.badge`, `.input`
   - State modifiers: `.text-muted`, `.surface--elevated`, `.btn--loading`

4. **Global Animations**
   - Keyframe definitions: `@keyframes rowFlash`, `@keyframes shimmer`
   - Animation classes: `.table-row--flash`, `.surface--flash`

5. **Viewport-Level Responsive Styles**
   - Global layout breakpoints affecting page chrome, navigation, or overall structure
   - Media queries that adjust `.layout-nav`, `main` padding, or other layout shells

**Everything else belongs in component-specific CSS Modules.**

### What Goes in CSS Modules

Component CSS Modules (`.module.css` files) should contain:

- **Component-specific class names** - Styles that only apply to one component
- **Component layout** - Grid/flexbox rules specific to the component's internal structure
- **Component states** - Hover, focus, active states unique to the component
- **Component container queries** - Responsive behavior based on container width (not viewport)
- **Component animations** - Transitions or animations used only by this component

## How to Style Components with CSS Modules

### Step 1: Create the CSS Module File

Place the CSS Module file next to your component:

```
components/MarketCard/
├── MarketCard.tsx
└── MarketCard.module.css
```

**Naming convention:** `ComponentName.module.css`

### Step 2: Import the Module

Import the module in your component:

```typescript
import styles from './ComponentName.module.css';
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

**When to use CSS Modules:**
- Custom layouts specific to your component
- Component-specific spacing or sizing
- Unique hover/focus states
- Container queries for component responsiveness

### Step 5: Use CSS Variables for Theming

Always reference design tokens from `globals.css` in your CSS Module:

```css
/* MarketCard.module.css */
.card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.5rem;
    transition: all var(--transition-base);
}

.title {
    color: var(--color-primary);
    font-size: 1.2rem;
}
```

**Never hardcode values:**

```css
/* ❌ Bad - hardcoded values break consistency */
.card {
    background: rgba(12, 18, 34, 0.88);
    border-radius: 16px;
    color: #4b8cff;
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

import styles from './MarketCard.module.css';

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

**`components/MarketCard/MarketCard.module.css`**
```css
/**
 * Market Card Styles
 *
 * Responsive card layout using container queries to adapt to available space.
 * Combines global .surface utility with component-specific layout and typography.
 */

.card {
    container-type: inline-size;
    container-name: market-card;
}

.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
}

.title {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--color-primary);
}

.price {
    font-size: 1.8rem;
    font-weight: 700;
    color: #f5f7ff;
}

/* Container query for responsive behavior */
@container market-card (max-width: 300px) {
    .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
    }

    .price {
        font-size: 1.4rem;
    }
}
```

**Key points:**
- `.surface` and `.badge` are utility classes from `globals.css`
- `.card`, `.header`, `.title`, `.price` are scoped to this component via CSS Modules
- CSS variables like `var(--color-primary)` ensure design system consistency
- Container queries adapt the component to its available space
- JSDoc comments explain the "why" before showing the "how"

## Design System Reference

### Core CSS Variables

These variables form the foundation of TronRelic's visual language:

| Variable | Purpose | Example Value |
|----------|---------|---------------|
| `--color-background` | Page background | `#03060f` |
| `--color-surface` | Card/panel backgrounds | `rgba(12, 18, 34, 0.88)` |
| `--color-border` | Default borders | `rgba(120, 180, 255, 0.14)` |
| `--color-primary` | Primary actions/links | `#4b8cff` |
| `--color-success` | Success states | `#57d48c` |
| `--color-warning` | Warning states | `#ffc857` |
| `--color-danger` | Error/danger states | `#ff6f7d` |
| `--color-text-muted` | Secondary text | `rgba(226, 234, 255, 0.64)` |
| `--radius-sm`, `--radius-md`, `--radius-lg` | Border radii | `10px`, `16px`, `24px` |
| `--shadow-sm`, `--shadow-md`, `--shadow-lg` | Elevation shadows | Various rgba values |
| `--transition-base` | Standard transitions | `160ms ease` |

**Always use these variables instead of hardcoding colors or values.** This ensures consistency and makes theme updates trivial.

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

#### Layout Utilities

```tsx
// Vertical stack
<div className="stack">
    <div>Item 1</div>
    <div>Item 2</div>
</div>

// Stack with custom gap
<div className="stack stack--lg">
    <div>Item 1</div>
    <div>Item 2</div>
</div>

// Grid with auto-fit columns
<div className="grid grid--responsive">
    <div>Card 1</div>
    <div>Card 2</div>
</div>

// Fixed columns
<div className="grid grid--cols-3">
    <div>Col 1</div>
    <div>Col 2</div>
    <div>Col 3</div>
</div>
```

## Responsive Design: Container Queries

**Rule: Always use CSS container queries for component-level responsiveness. Reserve viewport media queries exclusively for global layout changes.**

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

```css
/* Adapts when the container is narrow, regardless of viewport */
@container analytics-card (min-width: 480px) {
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

```css
/* TransactionCard.css */
.transaction-card {
    container-type: inline-size;
    container-name: transaction-card;
}

.transaction-card__grid {
    display: grid;
    grid-template-columns: 1fr; /* Single column by default */
    gap: 1rem;
}

/* When container is 480px+ wide, show 2 columns */
@container transaction-card (min-width: 480px) {
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

### 1. Always Use Container Queries

Plugins render in various contexts (full pages, cards, modals, slideouts). **Never use viewport media queries** for plugin component styling—always use container queries so your UI adapts to its container.

### 2. Import Design System Variables

Plugins should reference the same CSS variables as the core application:

```tsx
// In plugin component
<div style={{
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '1.5rem'
}}>
    Plugin content
</div>
```

### 3. Use CSS Modules for Plugin Styles

Create a colocated CSS Module for plugin-specific styles:

```tsx
// Good - combines utility classes with CSS Modules
import styles from './MyPlugin.module.css';

<div className="surface surface--padding-md">
    <div className={styles.pluginGrid}>
        <h2>Plugin Title</h2>
        <p className="text-muted">Description</p>
    </div>
</div>
```

**`MyPlugin.module.css`:**
```css
.pluginGrid {
    display: grid;
    gap: 1.5rem;
    container-type: inline-size;
}

@container (min-width: 600px) {
    .pluginGrid {
        grid-template-columns: repeat(2, 1fr);
    }
}
```

**Avoid - inline styles that duplicate design tokens:**
```tsx
// Bad - hardcoded values and inline styles
<div style={{
    background: 'rgba(12, 18, 34, 0.88)',
    padding: '1.5rem',
    borderRadius: '16px'
}}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <h2>Plugin Title</h2>
        <p style={{ color: 'rgba(226, 234, 255, 0.64)' }}>Description</p>
    </div>
</div>
```

### 4. Test in Multiple Contexts

Verify your plugin UI renders correctly in:
- Full-page view
- Narrow slideout (45% width)
- Modal dialog
- Mobile viewport (< 768px)

## SSR and Hydration

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

- [ ] Uses CSS variables from `globals.css` (no hardcoded colors or sizes)
- [ ] Component-specific styles are in a colocated CSS Module file (`ComponentName.module.css`)
- [ ] CSS Module is imported using `import styles from './ComponentName.module.css'`
- [ ] Uses container queries in CSS Modules for component-level responsiveness
- [ ] Uses built-in utility classes for common patterns (`.surface`, `.btn`, `.badge`, `.stack`, `.grid`)
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
- [Design System Colors and Variables](../../apps/frontend/app/globals.css) - Full reference of CSS variables
- [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react)
- [Icon Browser](https://lucide.dev/icons) - Browse all available icons
- [CSS Container Queries (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Container_Queries)
