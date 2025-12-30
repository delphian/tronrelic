# Frontend Overview

This document provides a high-level summary of TronRelic's frontend architecture and styling conventions. For detailed guidance on specific topics, refer to the specialized documentation linked throughout.

## Who This Document Is For

Frontend developers joining the TronRelic project who need to quickly understand the architectural patterns, file organization, and styling standards before diving into implementation work.

## Why These Patterns Matter

TronRelic's frontend follows strict architectural patterns that solve specific problems:

- **SSR + Live Updates eliminates loading flash** - Components render fully on the server with real data, then hydrate for interactivity and WebSocket updates. Users see content immediately, not loading spinners.
- **Feature-based organization prevents code sprawl** - Without clear boundaries, component files scatter across generic directories, making features hard to locate and maintain
- **UI styling system enables consistency** - The three-layer design token system and CSS Modules prevent visual fragmentation and naming collisions across components
- **Container queries enable plugin flexibility** - Viewport media queries fail when components render in sidebars, modals, or plugin contexts with constrained widths
- **Design system consistency prevents visual fragmentation** - Ad-hoc color values and spacing create disjointed interfaces that feel unprofessional

Following these patterns ensures your work integrates seamlessly and remains maintainable as the codebase grows.

## Core Architecture Principles

### SSR + Live Updates Pattern

**All public-facing components must render fully on the server with real data.** This is the foundational rendering pattern for TronRelic's frontend. Server components fetch data and pass it to client components as props. Client components initialize state from those props (not empty arrays), then establish WebSocket subscriptions for live updates after hydration.

**The pattern eliminates loading spinners:**
- Server component fetches data during SSR
- Client component receives data as prop: `useState(initialData)`
- HTML arrives with content, users see data immediately
- After hydration, WebSocket provides real-time updates

**See [react.md](./react/react.md#ssr--live-updates-pattern) for complete implementation guide including:**
- Step-by-step server/client component setup
- Critical rules and common mistakes
- When loading states ARE appropriate
- SSR + Live Updates checklist

### Feature-Based Organization

TronRelic organizes frontend code by feature, not by file type. Each feature module contains all related components, state management, hooks, and API calls in a single directory:

```
features/accounts/
├── components/          # React components for this feature
├── hooks/              # Feature-specific hooks
├── api/                # API client functions
├── slice.ts            # Redux state slice
└── index.ts            # Public API exports
```

This structure mirrors the backend's modular architecture and keeps related code colocated for easier discovery and maintenance.

**See [frontend-architecture.md](./frontend-architecture.md) for complete details on:**
- Full directory structure and organization
- Feature module patterns and conventions
- Import patterns and best practices
- Component folder organization (folder-based vs flat)
- Migration guidance from old structures

### React Component Architecture

TronRelic uses React with Next.js 14 App Router for building interactive UI components. The architecture separates server and client components, uses context providers for dependency injection, and favors hooks over higher-order components for logic reuse.

**Key React patterns:**

- **Context providers** - ModalProvider, ToastProvider, FrontendPluginContextProvider for cross-cutting concerns
- **Custom hooks** - Feature-specific hooks for WebSocket subscriptions, state management, and API calls
- **Server vs client components** - Server components for SSR, client components for interactivity
- **Composition patterns** - Component composition, render props, and plugin injection

**See [react.md](./react/react.md) for complete React architecture overview including:**
- Context provider system and composition order
- Custom hooks patterns and best practices
- Server vs client component decision matrix
- Hydration error prevention
- Component composition patterns
- Detailed component guides (IconPickerModal, etc.)

### UI Styling System

  1. Primitives (primitives.scss) — Raw values: --spacing-7: 1rem, --color-blue-500: #3b82f6
  2. Semantics (semantic-tokens.scss) — Named purpose, composed of primitives: --card-padding-md: var(--spacing-10)
  3. Components (.module.scss) — Select which semantic token to use based on context (breakpoints, state)
  4. Globals (globals.scss) — Utility classes for styling patterns that aren't tied to a specific component (.surface, .btn, .badge)

TronRelic implements a comprehensive UI styling system with two core architectural layers:

1. **`globals.scss`** - Design tokens (CSS variables), base resets, global animations, and styling utility classes (`.surface`, `.btn`, `.badge`)
2. **SCSS Modules** - Component-specific styles with scoped class names that prevent naming collisions

The design token system follows an industry-standard three-layer hierarchy (primitives → semantic tokens → application layer) used by Google Material Design, Adobe Spectrum, and GitHub Primer. This pattern enables consistent theming, predictable cascading updates, and single-source-of-truth maintenance.

Every component should reference design tokens from `globals.scss` (like `var(--color-primary)` or `var(--radius-md)`) and implement component-specific layout in colocated `.module.scss` files.

**See [ui.md](./ui/ui.md) for complete UI system overview including:**
- Two-layer SCSS architecture (globals.scss vs SCSS Modules)
- Three-layer design token hierarchy (primitives, semantic tokens, application layer)
- Layout components for page structure
- Container queries for responsive component behavior
- Icon usage with `lucide-react`
- SSR hydration patterns for timezone-sensitive data
- Complete styling checklist and quick reference

**See detailed implementation guides:**
- [ui-component-styling.md](./ui/ui-component-styling.md) - Comprehensive styling guide with code examples, layout components, animations, and accessibility patterns
- [ui-design-token-layers.md](./ui/ui-design-token-layers.md) - Industry-standard token hierarchy, complete token reference, and W3C alignment

### Component-First Layout Architecture

TronRelic uses **React components for layout primitives**, following the patterns established by major design systems like Chakra UI, Material UI, and Ant Design. This architectural decision provides TypeScript safety, IDE autocomplete, and encapsulated responsive behavior that utility classes cannot offer.

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
- **Encapsulation** - Responsive logic, accessibility attributes, and variants bundled in component
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
                <Card>...</Card>
                <Card>...</Card>
            </Grid>
        </Page>
    );
}
```

**Styling utility classes** (`.surface`, `.btn`, `.badge`) remain in `globals.scss` for visual styling concerns that work well as composable modifiers. Layout primitives use React components; visual styling uses utility classes.

## Quick Reference

### Creating a New Component

1. Create component folder: `features/my-feature/components/MyComponent/`
2. Add files:
   - `MyComponent.tsx` (implementation)
   - `MyComponent.module.scss` (styles)
   - `index.ts` (barrel export)
3. Import SCSS Module: `import styles from './MyComponent.module.scss'`
4. Use design tokens in SCSS: `color: var(--color-primary)`
5. Apply scoped classes: `<div className={styles.container}>`
6. Use layout components for structure: `<Stack gap="md">...</Stack>`
7. Mix with styling utilities when appropriate: `<div className={`surface ${styles.card}`}>`

### Layout Components

Use layout components from `components/layout/` for page structure:

```tsx
import { Page, PageHeader, Stack, Grid, Section } from '../../../components/layout';

<Page>
    <PageHeader title="Dashboard" subtitle="Overview of activity" />
    <Section>
        <Grid columns="responsive">
            <Card>...</Card>
        </Grid>
    </Section>
</Page>
```

| Component | Props | Purpose |
|-----------|-------|---------|
| `<Page>` | - | Page-level grid with responsive gap |
| `<PageHeader>` | `title`, `subtitle` | Page title section |
| `<Stack>` | `gap="sm\|md\|lg"`, `direction="vertical\|horizontal"` | Flex container with gap |
| `<Grid>` | `gap="sm\|md\|lg"`, `columns="2\|3\|responsive"` | Grid layout |
| `<Section>` | `gap="sm\|md\|lg"` | Content section with spacing |

### Container Queries Over Media Queries

Always use container queries for component responsiveness:

```scss
/* MyComponent.module.scss */
@use '../../../app/breakpoints' as *;

.container {
    container-type: inline-size;
    container-name: my-component;
}

@container my-component (min-width: #{$breakpoint-mobile-md}) {
    .grid {
        grid-template-columns: repeat(2, 1fr);
    }
}
```

Reserve viewport media queries (`@media`) exclusively for global layout changes in `app/layout.tsx`.

### Common Styling Utilities

| Pattern | Class | Example |
|---------|-------|---------|
| Surface background | `.surface` | `<div className="surface surface--padding-md">` |
| Primary button | `.btn .btn--primary` | `<button className="btn btn--primary btn--md">` |
| Status badge | `.badge .badge--success` | `<span className="badge badge--success">` |

### Feature Export Pattern

Every feature exports its public API through `index.ts`:

```typescript
// features/accounts/index.ts

// Components
export { AccountSummary } from './components/AccountSummary';
export { BookmarkPanel } from './components/BookmarkPanel';

// Redux slice
export { default as walletReducer } from './slice';
export * from './slice';

// Hooks
export { useWallet } from './hooks/useWallet';
```

Import from the feature root, not individual files:

```typescript
// Good
import { AccountSummary, BookmarkPanel } from '../../../features/accounts';

// Bad - bypasses public API
import { BookmarkPanel } from '../../../features/accounts/components/BookmarkPanel';
```

## Available Features

### Core Features

| Feature | Purpose | Key Components |
|---------|---------|----------------|
| **accounts** | Account management, wallet tracking, bookmarks | AccountSummary, BookmarkPanel, useWallet |
| **transactions** | Transaction feed, details, filtering | TransactionFeed, TransactionDetails, TransactionFilter |
| **whales** | Whale transaction tracking and analytics | WhaleDashboard |
| **blockchain** | Blockchain sync status and network metrics | (state only) |

### Supporting Features

| Feature | Purpose | Key Components |
|---------|---------|----------------|
| **charts** | Reusable chart components | LineChart, EnergyPriceChart, NetworkMetricsChart |
| **system** | System monitoring and administration | SystemOverview, BlockchainMonitor, MarketMonitor |
| **realtime** | WebSocket connection and live data sync | useRealtimeStatus, useSocketSubscription |
| **ui-state** | Global UI state (modals, toasts, loading) | (state only) |

## Pre-Ship Checklist

Before committing any UI component or plugin page, verify:

- [ ] Uses layout components (`Page`, `PageHeader`, `Stack`, `Grid`, `Section`) for page structure
- [ ] Uses CSS variables from `globals.scss` (no hardcoded colors or sizes)
- [ ] Component-specific styles are in colocated SCSS Module file
- [ ] Uses container queries for component-level responsiveness
- [ ] Uses styling utility classes for visual patterns (`.surface`, `.btn`, `.badge`)
- [ ] Uses `lucide-react` for all icons
- [ ] Provides visual feedback for state changes (loading, error, success)
- [ ] Uses semantic HTML (buttons, nav, lists, not generic divs)
- [ ] Includes ARIA labels for icon buttons and interactive elements
- [ ] Has visible focus states for all interactive elements
- [ ] Tested in multiple contexts (full-page, slideout, modal, mobile)
- [ ] JSDoc comments explain the "why" before showing the "how"

## Further Reading

**Detailed documentation:**
- [frontend-architecture.md](./frontend-architecture.md) - Complete file organization and feature module patterns
- [react.md](./react/react.md) - React component architecture with context providers, hooks, and server/client component patterns
- [ui.md](./ui/ui.md) - UI system overview with design tokens, CSS Modules, and styling standards
- [ui-component-styling.md](./ui/ui-component-styling.md) - Comprehensive styling guide with code examples, utility classes, and accessibility patterns
- [ui-design-token-layers.md](./ui/ui-design-token-layers.md) - Industry-standard token hierarchy, complete token reference, and theming system
- [documentation.md](../documentation.md) - Documentation standards and writing style

**React component guides:**
- [react/component-icon-picker-modal.md](./react/component-icon-picker-modal.md) - IconPickerModal component with ModalProvider integration

**Related topics:**
- [plugins.md](../plugins/plugins.md) - Plugin architecture (separate from features)
- [plugins-page-registration.md](../plugins/plugins-page-registration.md) - How plugins register frontend pages
- [plugins-frontend-context.md](../plugins/plugins-frontend-context.md) - Plugin frontend context and API access
