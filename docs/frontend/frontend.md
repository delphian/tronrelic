# Frontend Overview

This document provides a high-level summary of TronRelic's frontend architecture and styling conventions. For detailed guidance on specific topics, refer to the specialized documentation linked throughout.

## Who This Document Is For

Frontend developers joining the TronRelic project who need to quickly understand the architectural patterns, file organization, and styling standards before diving into implementation work.

## Why These Patterns Matter

TronRelic's frontend follows strict architectural patterns that solve specific problems:

- **Feature-based organization prevents code sprawl** - Without clear boundaries, component files scatter across generic directories, making features hard to locate and maintain
- **CSS Modules eliminate style conflicts** - Global styles cause naming collisions and make refactoring risky when changing one component breaks unrelated interfaces
- **Container queries enable plugin flexibility** - Viewport media queries fail when components render in sidebars, modals, or plugin contexts with constrained widths
- **Design system consistency prevents visual fragmentation** - Ad-hoc color values and spacing create disjointed interfaces that feel unprofessional

Following these patterns ensures your work integrates seamlessly and remains maintainable as the codebase grows.

## Core Architecture Principles

### Feature-Based Organization

TronRelic organizes frontend code by feature, not by file type. Each feature module contains all related components, state management, hooks, and API calls in a single directory:

```
features/markets/
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

### Two-Layer CSS System

TronRelic separates styling concerns into two distinct layers:

1. **`globals.css`** - Design tokens (CSS variables), utility classes, base resets, and global animations
2. **CSS Modules** - Component-specific styles with scoped class names that prevent naming collisions

Every component should reference design tokens from `globals.css` (like `var(--color-primary)` or `var(--radius-md)`) and implement component-specific layout in colocated `.module.css` files.

**See [frontend-component-guide.md](./frontend-component-guide.md) for complete details on:**
- What goes in `globals.css` vs CSS Modules
- How to create and use CSS Module files
- Design system variables reference
- Available utility classes (surfaces, buttons, badges, forms, layouts)
- Container queries for responsive behavior
- Icon usage with `lucide-react`
- Animation and state feedback patterns
- Accessibility best practices
- Plugin-specific styling considerations

## Quick Reference

### Creating a New Component

1. Create component folder: `features/my-feature/components/MyComponent/`
2. Add files:
   - `MyComponent.tsx` (implementation)
   - `MyComponent.module.css` (styles)
   - `index.ts` (barrel export)
3. Import CSS Module: `import styles from './MyComponent.module.css'`
4. Use design tokens in CSS: `color: var(--color-primary)`
5. Apply scoped classes: `<div className={styles.container}>`
6. Mix with utilities when appropriate: `<div className={`surface ${styles.card}`}>`

### Container Queries Over Media Queries

Always use container queries for component responsiveness:

```css
/* MyComponent.module.css */
.container {
    container-type: inline-size;
    container-name: my-component;
}

@container my-component (min-width: 480px) {
    .grid {
        grid-template-columns: repeat(2, 1fr);
    }
}
```

Reserve viewport media queries (`@media`) exclusively for global layout changes in `app/layout.tsx`.

### Common Utility Classes

| Pattern | Class | Example |
|---------|-------|---------|
| Surface background | `.surface` | `<div className="surface surface--padding-md">` |
| Primary button | `.btn .btn--primary` | `<button className="btn btn--primary btn--md">` |
| Status badge | `.badge .badge--success` | `<span className="badge badge--success">` |
| Vertical stack | `.stack` | `<div className="stack">` |
| Responsive grid | `.grid .grid--responsive` | `<div className="grid grid--responsive">` |

### Feature Export Pattern

Every feature exports its public API through `index.ts`:

```typescript
// features/markets/index.ts

// Components
export { MarketDashboard } from './components/MarketDashboard';
export { MarketTable } from './components/MarketTable';

// Redux slice
export { default as marketReducer } from './slice';
export * from './slice';

// Hooks
export { useMarketData } from './hooks/useMarketData';
```

Import from the feature root, not individual files:

```typescript
// Good
import { MarketDashboard, MarketTable } from '../../../features/markets';

// Bad - bypasses public API
import { MarketTable } from '../../../features/markets/components/MarketTable';
```

## Available Features

### Core Features

| Feature | Purpose | Key Components |
|---------|---------|----------------|
| **accounts** | Account management, wallet tracking, bookmarks | AccountSummary, BookmarkPanel, useWallet |
| **markets** | Energy market comparison and pricing | MarketDashboard, MarketTable, PriceCalculator |
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

- [ ] Uses CSS variables from `globals.css` (no hardcoded colors or sizes)
- [ ] Component-specific styles are in colocated CSS Module file
- [ ] Uses container queries for component-level responsiveness
- [ ] Uses built-in utility classes for common patterns
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
- [frontend-component-guide.md](./frontend-component-guide.md) - Comprehensive styling guide with code examples
- [documentation-guidance.md](../documentation-guidance.md) - Documentation standards and writing style

**Related topics:**
- [plugins.md](../plugins/plugins.md) - Plugin architecture (separate from features)
- [plugins-page-registration.md](../plugins/plugins-page-registration.md) - How plugins register frontend pages
- [plugins-frontend-context.md](../plugins/plugins-frontend-context.md) - Plugin frontend context and API access
