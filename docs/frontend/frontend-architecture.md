# Frontend Architecture

## Overview

The TronRelic frontend follows a **feature-based architecture** that mirrors the backend's modular structure. This approach improves maintainability, scalability, and developer experience by colocating all related code for each feature.

**This document focuses on file organization and folder structure.** For styling guidance (CSS Modules, design system, component patterns), see the [Frontend Component Guide](./frontend-component-guide.md).

## Directory Structure

```
apps/frontend/
├── app/                          # Next.js App Router (routes, pages, layouts)
│   ├── (dashboard)/             # Dashboard route group
│   ├── (marketing)/             # Marketing route group
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Home page
│   └── providers.tsx            # Redux & other providers
│
├── features/                     # Feature modules (NEW!)
│   ├── accounts/
│   │   ├── components/          # Account-specific components
│   │   ├── hooks/               # Account-specific hooks
│   │   ├── api/                 # Account API calls
│   │   ├── slice.ts             # Redux slice
│   │   └── index.ts             # Public exports
│   ├── markets/
│   ├── blockchain/
│   ├── transactions/
│   ├── whales/
│   ├── system/
│   ├── charts/
│   ├── comments/
│   ├── chat/
│   ├── realtime/
│   └── ui-state/
│
├── components/                   # Shared components only
│   ├── ui/                      # Design system (Button, Card, Badge, etc.)
│   ├── layout/                  # Layout components (NavBar)
│   ├── plugins/                 # Plugin system components
│   └── socket/                  # Socket.IO bridge
│
├── lib/                         # Utilities and configurations
├── store/                       # Redux store setup
├── hooks/                       # Global hooks (deprecated - move to features)
└── styles/                      # Global styles
```

## Feature Module Pattern

Each feature follows a consistent structure:

### File Organization

```
features/markets/
├── components/                      # React components
│   ├── MarketDashboard/
│   │   ├── MarketDashboard.tsx
│   │   ├── MarketDashboard.module.css  # Component-specific styles
│   │   └── index.ts                     # Barrel export
│   ├── MarketTable/
│   │   ├── MarketTable.tsx
│   │   ├── MarketTable.module.css
│   │   └── index.ts
│   ├── MarketCard/
│   │   ├── MarketCard.tsx
│   │   ├── MarketCard.module.css
│   │   └── index.ts
│   └── PriceCalculator/
│       ├── PriceCalculator.tsx
│       ├── PriceCalculator.module.css
│       └── index.ts
├── hooks/                           # Feature-specific hooks
│   └── useMarketData.ts
├── api/                             # API client functions
│   └── marketApi.ts
├── slice.ts                         # Redux state slice
├── types.ts                         # TypeScript types (optional)
└── index.ts                         # Public API exports
```

**Note:** This structure uses folder-based organization where each component lives in its own directory with colocated styles and tests. See the [Component Folder Organization](#component-folder-organization) section below for the rationale behind this pattern.

### index.ts Pattern

Every feature exports its public API through `index.ts`:

```typescript
/**
 * Markets Feature Module
 *
 * Handles energy market comparison and pricing
 */

// Components
export { MarketDashboard } from './components/MarketDashboard';
export { MarketTable } from './components/MarketTable';
export { MarketCard } from './components/MarketCard';
export { PriceCalculator } from './components/PriceCalculator';

// Redux slice
export { default as marketReducer } from './slice';
export * from './slice';

// Hooks (if any)
export { useMarketData } from './hooks/useMarketData';
```

## Import Patterns

### From App Pages

```typescript
// Recommended: Import from feature index
import { MarketDashboard, MarketTable } from '../../../features/markets';
import { AccountSummary } from '../../../features/accounts';

// Alternative: Import specific component
import { LineChart } from '../../../features/charts/components/LineChart';
```

### Within Features

```typescript
// Import from shared UI components
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

// Import from other features
import { LineChart } from '../../charts/components/LineChart';

// Import from lib/store
import { useAppSelector } from '../../../store/hooks';
import { api } from '../../../lib/api';
```

### In Redux Store

```typescript
import { configureStore } from '@reduxjs/toolkit';
import { marketReducer } from '../features/markets';
import { walletReducer, bookmarkReducer } from '../features/accounts';
import { transactionReducer } from '../features/transactions';

export const store = configureStore({
    reducer: {
        markets: marketReducer,
        wallet: walletReducer,
        bookmarks: bookmarkReducer,
        transactions: transactionReducer,
        // ...
    }
});
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
| **comments** | User comments and discussions | CommentStream |
| **chat** | Real-time chat functionality | (state only) |
| **realtime** | WebSocket connection and live data sync | useRealtimeStatus, useSocketSubscription |
| **ui-state** | Global UI state (modals, toasts, loading) | (state only) |

## Architecture Benefits

### Colocation

All code related to a feature lives together:
- Components in `features/markets/components/`
- State management in `features/markets/slice.ts`
- Hooks in `features/markets/hooks/`
- API calls in `features/markets/api/`

### Consistency

The feature structure mirrors the backend's modular architecture:
- Backend: `apps/backend/src/modules/markets/`
- Frontend: `apps/frontend/features/markets/`

Both follow the same mental model.

### Scalability

Adding a new feature is straightforward:
1. Create `features/my-feature/` directory
2. Add components, slice, hooks
3. Export through `index.ts`
4. Import in pages/store

### Maintainability

- Easy to find feature-specific code
- Clear boundaries between features
- Minimal coupling between features
- Self-contained features can be removed cleanly

## Migration from Old Structure

The previous flat structure has been reorganized:

### Before

```
components/
├── accounts/
├── markets/
├── transactions/
├── whales/
├── system/
└── charts/

store/slices/
├── marketSlice.ts
├── walletSlice.ts
├── transactionSlice.ts
└── ...

hooks/
├── useWallet.ts
├── useRealtimeStatus.ts
└── useSocketSubscription.ts
```

### After

```
features/
├── accounts/
│   ├── components/
│   ├── hooks/useWallet.ts
│   ├── slice.ts (was walletSlice.ts)
│   └── index.ts
├── markets/
│   ├── components/
│   ├── slice.ts (was marketSlice.ts)
│   └── index.ts
├── realtime/
│   ├── hooks/
│   │   ├── useRealtimeStatus.ts
│   │   └── useSocketSubscription.ts
│   ├── slice.ts
│   └── index.ts
└── ...
```

All imports have been updated throughout the codebase.

## Best Practices

### 1. Keep Features Self-Contained

Minimize dependencies between features. If feature A needs feature B's data, consider:
- Using Redux selectors to access B's state
- Exposing a clean API through B's `index.ts`
- Evaluating if the code should move to a shared utility

### 2. Use the Index Pattern

Always export public APIs through `index.ts`:
- Provides a clean import interface
- Hides implementation details
- Makes refactoring easier

### 3. Follow Naming Conventions

- Components: PascalCase (`MarketDashboard.tsx`)
- Slices: camelCase (`slice.ts` or `marketSlice.ts`)
- Hooks: camelCase with `use` prefix (`useMarketData.ts`)
- Index: lowercase (`index.ts`)

### 4. Document Features

Add JSDoc comments to:
- Feature index files (describe the feature's purpose)
- Exported components and hooks
- Complex functions

### 5. Create Focused Slices

Each Redux slice should manage a single concern:
- ✅ `marketSlice` manages market data
- ✅ `walletSlice` manages wallet state
- ❌ Avoid: `appSlice` managing everything

### 6. Share Through Exports

Don't import directly from other features' internals:

```typescript
// ❌ Bad
import { MarketTable } from '../../markets/components/MarketTable';

// ✅ Good
import { MarketTable } from '../../markets';
```

### 7. Use Component Folders for Organization

Organize each component in its own folder for better maintainability:

```
components/MarketCard/
├── MarketCard.tsx            # Component implementation
├── MarketCard.module.css     # Component-specific styles
├── MarketCard.test.tsx       # Component tests
└── index.ts                  # Barrel export
```

**Benefits:**
- All component files colocated in one place
- Easy to find related files (styles, tests, types)
- Clean imports via barrel exports (`import { MarketCard } from './components/MarketCard'`)
- Scalable pattern that works for simple and complex components

See [Frontend Component Guide](./frontend-component-guide.md) for styling patterns and design system usage.

## Component Folder Organization

### Why Folder-Based Components?

TronRelic uses folder-based component organization where each component lives in its own directory with all related files colocated. This pattern solves several maintainability problems:

- **Easy discovery** - All files related to a component live in one predictable location
- **Clear ownership** - No ambiguity about which styles, tests, or types belong to which component
- **Safe refactoring** - Delete the folder, delete the component—no orphaned files
- **Scalable growth** - Works equally well for simple components and complex ones with multiple supporting files

### Standard Component Folder Structure

Every component folder follows this pattern:

```
ComponentName/
├── ComponentName.tsx              # Component implementation
├── ComponentName.module.css       # Component-specific styles
├── ComponentName.module.css.d.ts  # TypeScript type declarations for CSS
├── ComponentName.test.tsx         # Component tests (optional)
└── index.ts                       # Barrel export
```

**Example: MarketCard component**

```
components/ui/MarketCard/
├── MarketCard.tsx
├── MarketCard.module.css
├── MarketCard.module.css.d.ts
├── MarketCard.test.tsx
└── index.ts
```

### File Naming Conventions

- **Component file:** `ComponentName.tsx` (PascalCase, matches component name)
- **CSS Module:** `ComponentName.module.css` (PascalCase + `.module.css` suffix)
- **CSS Types:** `ComponentName.module.css.d.ts` (TypeScript declarations)
- **Tests:** `ComponentName.test.tsx` (matches component name + `.test` suffix)
- **Barrel export:** `index.ts` (lowercase)

### Barrel Export Pattern

Every component folder includes an `index.ts` file that re-exports the component:

```typescript
/**
 * Market Card Component
 *
 * Displays energy market provider information with pricing, availability,
 * and reliability metrics. Adapts layout based on container width.
 */

export { MarketCard } from './MarketCard';
export type { MarketCardProps } from './MarketCard';
```

This enables clean imports from outside the folder:

```typescript
// Clean import via barrel export
import { MarketCard } from '../../../components/ui/MarketCard';

// Instead of
import { MarketCard } from '../../../components/ui/MarketCard/MarketCard';
```

### Where to Place Component Folders

**Shared UI components** (used across multiple features):
```
components/ui/
├── Card/
├── Button/
├── Badge/
└── Input/
```

**Feature-specific components** (used within a single feature):
```
features/markets/
└── components/
    ├── MarketDashboard/
    ├── MarketTable/
    └── PriceCalculator/
```

**Layout components** (navigation, page shells):
```
components/layout/
├── NavBar/
├── BlockTicker/
└── Footer/
```

### Complex Components with Multiple Files

For complex components with additional files, expand the folder as needed:

```
ComplexComponent/
├── ComplexComponent.tsx           # Main component
├── ComplexComponent.module.css    # Styles
├── ComplexComponent.test.tsx      # Tests
├── ComplexComponentUtils.ts       # Helper functions
├── ComplexComponentTypes.ts       # Type definitions
├── ComplexComponentContext.tsx    # React context (if needed)
└── index.ts                       # Public exports
```

The `index.ts` controls what's exported publicly:

```typescript
/**
 * Complex Component
 *
 * Description of the component's purpose and usage.
 */

export { ComplexComponent } from './ComplexComponent';
export type { ComplexComponentProps } from './ComplexComponentTypes';

// Don't export internal utilities or context
// (keep them private to the component)
```

### Migration from Flat Structure

If you encounter components still using the old flat structure:

**Before (flat):**
```
components/
├── MarketCard.tsx
├── MarketCard.module.css
├── MarketTable.tsx
└── MarketTable.module.css
```

**After (folder-based):**
```
components/
├── MarketCard/
│   ├── MarketCard.tsx
│   ├── MarketCard.module.css
│   └── index.ts
└── MarketTable/
    ├── MarketTable.tsx
    ├── MarketTable.module.css
    └── index.ts
```

**Migration steps:**
1. Create the component folder
2. Move component file and styles into folder
3. Create `index.ts` with barrel export
4. Update all import paths throughout the codebase
5. Verify tests still pass

## Testing Strategy

Colocate tests with the code they test using the folder-based pattern:

```
features/markets/
├── components/
│   └── MarketTable/
│       ├── MarketTable.tsx
│       ├── MarketTable.module.css
│       ├── MarketTable.test.tsx
│       └── index.ts
├── slice.ts
└── slice.test.ts
```

Tests live inside component folders alongside the implementation, making it easy to find and maintain both together.

## Comparison with Backend

The frontend feature structure intentionally mirrors the backend:

| Backend | Frontend |
|---------|----------|
| `src/modules/markets/market.controller.ts` | `features/markets/components/MarketDashboard.tsx` |
| `src/modules/markets/market.service.ts` | `features/markets/api/marketApi.ts` |
| `src/database/models/Market.ts` | `features/markets/slice.ts` |

This parallelism helps developers navigate both codebases efficiently.

## Future Enhancements

Potential improvements:

1. **API Layer**: Add `features/*/api/` directories for API client functions
2. **Types**: Create `features/*/types.ts` for feature-specific types
3. **Lazy Loading**: Implement code splitting for large features
4. **Feature Flags**: Add runtime feature toggles
5. **Micro-frontends**: Consider splitting into separate deployable units

## Related Documentation

- [Frontend Component Guide](./frontend-component-guide.md) - How to style components (CSS Modules, design system, patterns)
- [Feature Modules README](../../apps/frontend/features/README.md) - Detailed feature documentation
- [Plugin System](../plugins/plugins.md) - Plugin architecture (separate from features)
- [Backend Modules](../backend-architecture.md) - Backend modular structure
