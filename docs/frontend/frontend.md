# Frontend Overview

This document provides a high-level summary of TronRelic's frontend architecture and styling conventions. For detailed guidance on specific topics, refer to the specialized documentation linked throughout.

## Who This Document Is For

Frontend developers joining the TronRelic project who need to quickly understand the architectural patterns, file organization, and styling standards before diving into implementation work.

## Why These Patterns Matter

TronRelic's frontend follows strict architectural patterns that solve specific problems:

- **Feature-based organization prevents code sprawl** - Without clear boundaries, component files scatter across generic directories, making features hard to locate and maintain
- **UI styling system enables consistency** - The three-layer design token system and CSS Modules prevent visual fragmentation and naming collisions across components
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

TronRelic implements a comprehensive UI styling system with two core architectural layers:

1. **`globals.css`** - Design tokens (CSS variables), utility classes, base resets, and global animations
2. **CSS Modules** - Component-specific styles with scoped class names that prevent naming collisions

The design token system follows an industry-standard three-layer hierarchy (primitives → semantic tokens → utility classes) used by Google Material Design, Adobe Spectrum, and GitHub Primer. This pattern enables consistent theming, predictable cascading updates, and single-source-of-truth maintenance.

Every component should reference design tokens from `globals.css` (like `var(--color-primary)` or `var(--radius-md)`) and implement component-specific layout in colocated `.module.css` files.

**See [ui.md](./ui/ui.md) for complete UI system overview including:**
- Two-layer CSS architecture (globals.css vs CSS Modules)
- Three-layer design token hierarchy (primitives, semantic tokens, utility classes)
- Container queries for responsive component behavior
- Icon usage with `lucide-react`
- SSR hydration patterns for timezone-sensitive data
- Complete styling checklist and quick reference

**See detailed implementation guides:**
- [ui-component-styling.md](./ui/ui-component-styling.md) - Comprehensive styling guide with code examples, utility classes, animations, and accessibility patterns
- [ui-design-token-layers.md](./ui/ui-design-token-layers.md) - Industry-standard token hierarchy, complete token reference, and W3C alignment

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
