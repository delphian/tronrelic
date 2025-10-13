# Frontend Feature Modules

This directory contains feature-based modules following a consistent structure that mirrors the backend's modular architecture.

## Why Feature-Based Structure?

The feature-based structure provides:

- **Colocation**: Everything related to a feature lives together (components, state, hooks, API calls)
- **Scalability**: Easy to find and modify feature-specific code
- **Consistency**: Mirrors backend's modular approach for better mental model
- **Maintainability**: Self-contained features are easier to test and refactor
- **Team collaboration**: Different teams can own different features with minimal conflicts

## Directory Structure

Each feature module follows this consistent pattern:

```
features/
├── accounts/
│   ├── components/          # Account-specific React components
│   ├── hooks/               # Account-specific hooks
│   ├── api/                 # Account API client functions
│   ├── slice.ts             # Redux slice for account state
│   ├── bookmarkSlice.ts     # Additional slices if needed
│   └── index.ts             # Public exports
├── markets/
│   ├── components/
│   ├── hooks/
│   ├── api/
│   ├── slice.ts
│   └── index.ts
└── ...
```

## Available Features

### Core Features

- **accounts** - Account management, wallet tracking, and bookmarks
- **blockchain** - Blockchain sync status and network metrics
- **markets** - Energy market comparison and pricing
- **transactions** - Transaction feed, details, and filtering
- **whales** - Whale transaction tracking and analytics

### Supporting Features

- **charts** - Reusable chart components (shared across features)
- **comments** - User comments and discussions
- **system** - System monitoring and administration
- **chat** - Real-time chat functionality
- **realtime** - WebSocket connection and real-time data sync
- **ui-state** - Global UI state (modals, toasts, loading states)

## Import Patterns

### From App Pages

```typescript
// Import from feature index (recommended)
import { MarketDashboard, MarketTable } from '../../../features/markets';
import { AccountSummary, BookmarkPanel } from '../../../features/accounts';

// Import specific components (when needed)
import { LineChart } from '../../../features/charts/components/LineChart';
```

### Within Feature Components

```typescript
// Import from shared components
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

// Import from other features
import { LineChart } from '../../charts/components/LineChart';

// Import from lib/store
import { useAppSelector } from '../../../store/hooks';
import { getMarketHistory } from '../../../lib/api';
```

### In Redux Store

```typescript
// Import reducers from feature modules
import { marketReducer } from '../features/markets';
import { walletReducer, bookmarkReducer } from '../features/accounts';
import { transactionReducer } from '../features/transactions';
```

## Creating a New Feature

1. **Create the feature directory**:
   ```bash
   mkdir -p apps/frontend/features/my-feature/{components,hooks,api}
   ```

2. **Create the Redux slice** (if needed):
   ```typescript
   // apps/frontend/features/my-feature/slice.ts
   import { createSlice } from '@reduxjs/toolkit';

   export interface MyFeatureState {
       // state shape
   }

   const initialState: MyFeatureState = {
       // initial state
   };

   const myFeatureSlice = createSlice({
       name: 'myFeature',
       initialState,
       reducers: {
           // reducers
       }
   });

   export const { actions } = myFeatureSlice;
   export default myFeatureSlice.reducer;
   ```

3. **Create components**:
   ```typescript
   // apps/frontend/features/my-feature/components/MyComponent.tsx
   'use client';

   export function MyComponent() {
       return <div>My Component</div>;
   }
   ```

4. **Create the index file**:
   ```typescript
   // apps/frontend/features/my-feature/index.ts
   /**
    * My Feature Module
    *
    * Description of what this feature does
    */

   // Components
   export { MyComponent } from './components/MyComponent';

   // Redux slice
   export { default as myFeatureReducer } from './slice';
   export * from './slice';

   // Hooks
   export { useMyFeature } from './hooks/useMyFeature';
   ```

5. **Register in Redux store** (if applicable):
   ```typescript
   // apps/frontend/store/index.ts
   import { myFeatureReducer } from '../features/my-feature';

   export const store = configureStore({
       reducer: {
           // ...
           myFeature: myFeatureReducer,
       }
   });
   ```

## Shared Components

The `components/` directory now contains **only** truly shared components:

- `components/ui/` - Design system components (Button, Card, Badge, Input, etc.)
- `components/layout/` - Layout components (NavBar)
- `components/plugins/` - Plugin system components (PluginLoader)
- `components/socket/` - Socket.IO bridge (SocketBridge)
- `components/legacy/` - Legacy marketing components (ArticlesList, ForumHub, etc.)

**All feature-specific components have been moved to their respective feature modules.**

## Migration from Old Structure

The old structure had:
- `components/accounts/` → Now `features/accounts/components/`
- `components/markets/` → Now `features/markets/components/`
- `store/slices/marketSlice.ts` → Now `features/markets/slice.ts`
- `hooks/useWallet.ts` → Now `features/accounts/hooks/useWallet.ts`

All imports have been updated to use the new feature-based structure.

## Best Practices

1. **Keep features self-contained**: Minimize dependencies between features
2. **Use the index.ts**: Export public API through index.ts, keep internals private
3. **Colocate related code**: Keep components, state, and logic for a feature together
4. **Follow naming conventions**: Use clear, descriptive names for components and files
5. **Document your feature**: Add JSDoc comments to exported functions and components
6. **Create focused slices**: Each slice should manage a single concern
7. **Share through exports**: Use index.ts to expose only what other features need

## Testing

Test files should be colocated with the code they test:

```
features/markets/
├── components/
│   ├── MarketTable.tsx
│   └── MarketTable.test.tsx
├── slice.ts
└── slice.test.ts
```

## Future Enhancements

Potential improvements to consider:

- Add `api/` subdirectories for API client functions
- Create feature-specific types files
- Add feature-specific utilities
- Implement lazy loading for large features
- Add feature flags for experimental features
