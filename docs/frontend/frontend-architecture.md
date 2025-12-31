# Frontend Architecture

## Overview

The TronRelic frontend follows a **module-based architecture** that mirrors the backend's modular structure. This approach improves maintainability, scalability, and developer experience by colocating all related code for each domain.

**Primary pattern:** New frontend code belongs in `modules/` for cross-cutting domain infrastructure. The legacy `features/` directory contains page-specific code and very small features that don't warrant a full module.

**This document focuses on file organization and folder structure.** For styling guidance (CSS Modules, design system, component patterns), see the [Frontend Component Guide](./ui/ui-component-styling.md).

## Directory Structure

```
apps/frontend/
├── app/                          # Next.js App Router (thin route wrappers)
│   ├── (core)/             # Dashboard route group
│   │   ├── system/users/        # Admin page → imports from modules/user
│   │   └── ...                  # Other admin pages
│   ├── u/[address]/             # Profile route → imports from modules/user
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Home page
│   └── providers.tsx            # Redux & other providers
│
├── modules/                      # Domain modules (cross-cutting, app-wide)
│   └── user/                    # User identity domain
│       ├── components/          # All user-related components
│       │   ├── admin/           # Admin components (UsersMonitor)
│       │   ├── Profile/         # Profile page components
│       │   └── WalletButton/    # Reusable wallet button
│       ├── hooks/               # useWallet, useSessionTracking
│       ├── api/                 # API client functions
│       ├── lib/                 # Identity utilities, SSR helpers
│       ├── slice.ts             # Redux slice
│       └── index.ts             # Public exports
│
├── features/                     # Feature modules (page-specific)
│   ├── accounts/
│   │   ├── components/          # Account-specific components
│   │   ├── hooks/               # Account-specific hooks
│   │   ├── api/                 # Account API calls
│   │   ├── slice.ts             # Redux slice
│   │   └── index.ts             # Public exports
│   ├── blockchain/
│   ├── transactions/
│   ├── whales/
│   ├── system/                  # System admin (contexts, shared components)
│   ├── charts/
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
└── hooks/                       # Global hooks (deprecated - move to modules/features)
```

## Modules vs Features

The frontend uses two organizational patterns for domain code. Understanding when to use each prevents structural inconsistency.

### When to Use `modules/`

Use `modules/` for **cross-cutting domain infrastructure** that:

- Wraps the entire application (providers, identity)
- Is used across multiple unrelated routes
- Contains both app-wide and page-specific components for the same domain
- Manages shared state that multiple features depend on

**Example:** The `user` module contains identity infrastructure (UserIdentityProvider wraps the app), reusable components (WalletButton used in header), page components (Profile, UsersMonitor), and shared state (Redux slice for user data).

### When to Use `features/` (Legacy/Small Features)

Use `features/` for **page-specific code** or **very small features** that:

- Serves a specific route or set of related routes
- Doesn't wrap the application
- Contains components only used within that feature
- Has minimal cross-feature dependencies
- Is too small to warrant a full module

**Example:** The `system` feature contains admin monitoring components (BlockchainMonitor) and the SystemAuthContext—all specific to `/system/*` admin routes. Small utilities like `ui-state` that only manage Redux state without components are also appropriate for `features/`.

**Note:** This is the legacy pattern. When adding significant new functionality, prefer creating a module in `modules/` instead.

### Decision Matrix

| Criteria | Use `modules/` | Use `features/` |
|----------|---------------|-----------------|
| Wraps entire app | Yes | No |
| Used across unrelated routes | Yes | No |
| Single domain, multiple concerns (admin + public) | Yes | No |
| Page-specific components only | No | Yes |
| Provides contexts for limited routes | No | Yes |

## Thin Route Wrappers

Routes in `app/` should be minimal importers, not implementation containers. The actual components live in `modules/` or `features/`.

### Why Thin Wrappers

- **Domain cohesion** - All user-related code lives in `modules/user/`, not scattered across route directories
- **Easy discovery** - Find all user components in one place, regardless of which route uses them
- **Cleaner routes** - `app/` directory is purely about URL structure, not implementation
- **Simpler refactoring** - Move routes without moving component logic

### Correct Pattern

```typescript
// app/(core)/system/users/page.tsx - THIN WRAPPER
'use client';

import { useSystemAuth } from '../../../../features/system';
import { UsersMonitor } from '../../../../modules/user';

export default function SystemUsersPage() {
    const { token } = useSystemAuth();
    return <UsersMonitor token={token} />;
}
```

```typescript
// app/u/[address]/page.tsx - THIN WRAPPER
import { ProfilePage } from '../../../modules/user/components/Profile/ProfilePage';

export default async function Page({ params }) {
    const { address } = await params;
    return <ProfilePage address={address} />;
}
```

### Incorrect Pattern

```typescript
// app/(core)/system/users/page.tsx - TOO MUCH IMPLEMENTATION
'use client';

import { useState, useEffect } from 'react';
// ... 500 lines of component code that should be in modules/user/
```

### When Colocation in `app/` Is Acceptable

Use `_components/` folders in `app/` routes only for:

- Truly route-specific UI that doesn't belong to any domain
- Layout variations specific to a route group
- One-off components with no reuse potential

For domain code (user, accounts, transactions), always use `modules/` or `features/`.

## Module Pattern

Each module follows a consistent structure:

### File Organization

```
modules/user/
├── components/                      # React components
│   ├── Profile/
│   │   ├── ProfilePage.tsx
│   │   ├── Profile.module.css       # Component-specific styles
│   │   └── index.ts                 # Barrel export
│   ├── WalletButton/
│   │   ├── WalletButton.tsx
│   │   ├── WalletButton.module.scss
│   │   └── index.ts
│   └── admin/                       # Admin-specific components
│       └── UsersMonitor/
├── hooks/                           # Module-specific hooks
│   ├── useWallet.ts
│   └── useSessionTracking.ts
├── api/                             # API client functions
│   └── client.ts
├── lib/                             # Utilities and helpers
│   ├── identity.ts
│   └── server.ts
├── types/                           # TypeScript types
│   └── user.types.ts
├── slice.ts                         # Redux state slice
└── index.ts                         # Public API exports
```

**Note:** This structure uses folder-based organization where each component lives in its own directory with colocated styles and tests. See the [Component Folder Organization](#component-folder-organization) section below for the rationale behind this pattern.

### index.ts Pattern

Every module exports its public API through `index.ts`:

```typescript
/**
 * User Module
 *
 * Handles user identity, wallet management, profiles, and session tracking
 */

// Components
export { UserIdentityProvider } from './components/UserIdentityProvider';
export { WalletButton } from './components/WalletButton';
export { ProfilePage } from './components/Profile';
export { UsersMonitor } from './components/admin';

// Redux slice
export { default as userReducer } from './slice';
export * from './slice';

// Hooks
export { useWallet } from './hooks/useWallet';
export { useSessionTracking } from './hooks/useSessionTracking';

// Types
export type { User, UserPreferences } from './types';
```

## Import Patterns

### From App Pages

```typescript
// Recommended: Import from module index
import { WalletButton, useWallet } from '../../../modules/user';
import { AddressLabel } from '../../../modules/address-labels';

// For legacy features: Import from feature index
import { AccountSummary } from '../../../features/accounts';
import { TransactionFeed } from '../../../features/transactions';
```

### Within Modules

```typescript
// Import from shared UI components
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

// Import from other modules
import { AddressLabel } from '../../address-labels';

// Import from lib/store
import { useAppSelector } from '../../../store/hooks';
import { api } from '../../../lib/api';
```

### In Redux Store

```typescript
import { configureStore } from '@reduxjs/toolkit';
import { userReducer } from '../modules/user';
import { walletReducer, bookmarkReducer } from '../features/accounts';
import { transactionReducer } from '../features/transactions';
import { blockchainReducer } from '../features/blockchain';

export const store = configureStore({
    reducer: {
        user: userReducer,
        wallet: walletReducer,
        bookmarks: bookmarkReducer,
        transactions: transactionReducer,
        blockchain: blockchainReducer,
        // ...
    }
});
```

## Available Modules and Features

### Modules (Primary Pattern)

Use `modules/` for cross-cutting domain infrastructure:

| Module | Purpose | Key Components |
|--------|---------|----------------|
| **user** | User identity, wallet management, profiles | UserIdentityProvider, WalletButton, ProfilePage, useWallet |
| **menu** | Navigation menu system | PriorityNav, useMenuConfig |
| **address-labels** | Address labeling and display | AddressLabel |
| **scheduler** | Scheduler monitoring UI | SchedulerMonitor |

### Features (Legacy/Small Features)

Use `features/` for page-specific code or small features:

| Feature | Purpose | Key Components |
|---------|---------|----------------|
| **accounts** | Account management, bookmarks | AccountSummary, BookmarkPanel |
| **transactions** | Transaction feed, details, filtering | TransactionFeed, TransactionDetails |
| **whales** | Whale transaction tracking | WhaleDashboard |
| **blockchain** | Blockchain sync status | (state only) |
| **charts** | Reusable chart components | LineChart, EnergyPriceChart |
| **system** | System monitoring and administration | SystemOverview, BlockchainMonitor |
| **realtime** | WebSocket connection and live data sync | useRealtimeStatus, useSocketSubscription |
| **ui-state** | Global UI state (modals, toasts, loading) | (state only) |

## Architecture Benefits

### Colocation

All code related to a domain lives together:
- Components in `modules/user/components/`
- State management in `modules/user/slice.ts`
- Hooks in `modules/user/hooks/`
- API calls in `modules/user/api/`

### Consistency

The module structure mirrors the backend's modular architecture:
- Backend: `apps/backend/src/modules/user/`
- Frontend: `apps/frontend/modules/user/`

Both follow the same mental model.

### Scalability

Adding a new module is straightforward:
1. Create `modules/my-module/` directory
2. Add components, slice, hooks
3. Export through `index.ts`
4. Import in pages/store

### Maintainability

- Easy to find module-specific code
- Clear boundaries between modules
- Minimal coupling between modules
- Self-contained modules can be removed cleanly

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

### 1. Keep Modules Self-Contained

Minimize dependencies between modules. If module A needs module B's data, consider:
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
- ✅ `walletSlice` manages wallet state
- ✅ `transactionSlice` manages transaction data
- ❌ Avoid: `appSlice` managing everything

### 6. Share Through Exports

Don't import directly from other modules' internals:

```typescript
// ❌ Bad
import { WalletButton } from '../../user/components/WalletButton/WalletButton';

// ✅ Good
import { WalletButton } from '../../user';
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

See [Frontend Component Guide](./ui/ui-component-styling.md) for styling patterns and design system usage.

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
| `src/modules/blockchain/blockchain.controller.ts` | `features/blockchain/components/BlockchainMonitor.tsx` |
| `src/modules/blockchain/blockchain.service.ts` | `features/blockchain/api/blockchainApi.ts` |
| `src/database/models/Block.ts` | `features/blockchain/slice.ts` |

This parallelism helps developers navigate both codebases efficiently.

## Future Enhancements

Potential improvements:

1. **API Layer**: Add `features/*/api/` directories for API client functions
2. **Types**: Create `features/*/types.ts` for feature-specific types
3. **Lazy Loading**: Implement code splitting for large features
4. **Feature Flags**: Add runtime feature toggles
5. **Micro-frontends**: Consider splitting into separate deployable units

## Environment Configuration and Runtime Contexts

### Why This Matters

Next.js applications run in two distinct environments: server-side during rendering (SSR) and client-side in the browser. Using the wrong backend URL in each context causes critical failures:

- **SSR with public URL** - Results in 502 Bad Gateway errors when Docker containers can't reach external URLs
- **Client with internal URL** - Causes browser requests to fail because `http://backend:4000` isn't accessible from outside the container
- **Direct environment access** - Makes code fragile and prevents runtime switching between development and production URLs

TronRelic solves this by centralizing all backend URL handling through a single configuration module that detects the runtime context and returns the appropriate URL automatically.

### Environment Variables by Context

TronRelic uses different environment variables depending on where code executes:

| Variable | Context | Purpose | Example |
|----------|---------|---------|---------|
| `SITE_BACKEND` | SSR only (server) | Backend service URL for Next.js server (from .env) | `http://backend:4000` (Docker) or `http://localhost:4000` (local) |
| `NEXT_PUBLIC_API_URL` | Client only (browser) | Public backend URL for browser requests | `https://tronrelic.com/api` |
| `NEXT_PUBLIC_SOCKET_URL` | Client only (browser) | Public WebSocket URL for real-time connections | `https://tronrelic.com` |
| `NEXT_PUBLIC_SITE_URL` | Both contexts | Public site URL for metadata and redirects | `https://tronrelic.com` |

**Key principle:** Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser bundle. Variables without the prefix are server-only and stay secure.

### Centralized Configuration Pattern

All backend URL logic lives in `/apps/frontend/lib/config.ts`. Never access environment variables directly in feature code.

**The configuration module provides:**

```typescript
import { config, getApiUrl } from '@/lib/config';

// Automatically selects correct URL for SSR vs client
config.apiBaseUrl;     // http://backend:4000/api (SSR) or https://tronrelic.com/api (client)
config.socketUrl;      // http://backend:4000 (SSR) or https://tronrelic.com (client)
config.siteUrl;        // https://tronrelic.com (both contexts)

// Helper for building API URLs
getApiUrl('/markets/compare');  // Returns absolute URL (SSR) or relative URL (client)
```

**How it works:**

The `getBackendBaseUrl()` function checks `typeof window` to determine the runtime context:

```typescript
function getBackendBaseUrl(): string {
  // Server-side (SSR): SITE_BACKEND is required
  if (typeof window === 'undefined') {
    if (!process.env.SITE_BACKEND) {
      throw new Error('SITE_BACKEND environment variable is required for server-side rendering');
    }
    return process.env.SITE_BACKEND;
  }

  // Client-side: Use public URL from environment or detect from window.location
  const envUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL;
  if (envUrl) {
    return envUrl.replace(/\/api$/, '');
  }

  // Fallback: dynamically detect from current page
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  return `${protocol}//${hostname}:4000`;
}
```

### Correct Usage Patterns

**Feature API calls (use axios client):**

```typescript
// apps/frontend/lib/api.ts
import axios from 'axios';
import { config } from './config';

// Configure once at module level
export const apiClient = axios.create({
  baseURL: config.apiBaseUrl,  // Correct URL for SSR and client
  timeout: 5000
});

// All API functions use the pre-configured client
export async function getMarkets(limit?: number) {
  const response = await apiClient.get('/markets/compare', {
    params: limit ? { limit } : undefined
  });
  return response.data.markets;
}
```

**Server-side data fetching in Next.js pages:**

```typescript
// app/(core)/markets/page.tsx
import { getApiUrl } from '@/lib/config';

export default async function MarketsPage() {
  // getApiUrl returns absolute URL with internal service name during SSR
  const response = await fetch(getApiUrl('/markets/compare'));
  const data = await response.json();

  return <MarketDashboard markets={data.markets} />;
}
```

**Client-side socket connections:**

```typescript
// features/realtime/socket.ts
import { io } from 'socket.io-client';
import { config } from '@/lib/config';

export const socket = io(config.socketUrl, {
  transports: ['websocket', 'polling']
});
```

### Incorrect Patterns to Avoid

**Never access environment variables directly:**

```typescript
// ❌ BAD - Hardcodes client URL, breaks SSR in Docker
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

// ✅ GOOD - Uses centralized config
import { config } from '@/lib/config';
const apiUrl = config.apiBaseUrl;
```

**Never build URLs manually:**

```typescript
// ❌ BAD - No context awareness
const url = `${process.env.NEXT_PUBLIC_API_URL}/markets/compare`;

// ✅ GOOD - Context-aware helper
import { getApiUrl } from '@/lib/config';
const url = getApiUrl('/markets/compare');
```

**Never use public URLs in SSR context:**

```typescript
// ❌ BAD - Causes 502 errors in Docker deployments
export default async function Page() {
  // This runs server-side and tries to reach https://tronrelic.com from inside Docker
  const response = await fetch('https://tronrelic.com/api/markets/compare');
  // ...
}

// ✅ GOOD - Uses internal service URL during SSR
import { getApiUrl } from '@/lib/config';

export default async function Page() {
  // Returns http://backend:4000/api/markets/compare during SSR
  const response = await fetch(getApiUrl('/markets/compare'));
  // ...
}
```

### Development vs Production Configuration

The same config module works across environments by reading different variable values:

**Development (local):**

```bash
# .env
SITE_BACKEND=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Production (Docker):**

```bash
# .env
SITE_BACKEND=http://backend:4000
NEXT_PUBLIC_API_URL=https://tronrelic.com/api
NEXT_PUBLIC_SOCKET_URL=https://tronrelic.com
NEXT_PUBLIC_SITE_URL=https://tronrelic.com
```

Code never changes—only the environment variable values differ.

### Troubleshooting URL Issues

**Symptom: 502 Bad Gateway errors in production**

- **Cause:** SSR code not using `SITE_BACKEND` (internal service URL)
- **Fix:** Ensure `SITE_BACKEND` is set in .env and use `config.apiBaseUrl` or `getApiUrl()`

**Symptom: CORS errors in browser**

- **Cause:** Client-side code using internal Docker service name (`http://backend:4000`)
- **Fix:** Use runtime config from `getRuntimeConfig()` which provides correct public URLs

**Symptom: WebSocket connection failures**

- **Cause:** Socket.IO client using wrong URL for runtime context
- **Fix:** Use `config.socketUrl` instead of hardcoded URLs

**Verification steps:**

1. Check runtime context logs: Add `console.log('typeof window:', typeof window)` to confirm SSR vs client
2. Check resolved URLs: Add `console.log('Using URL:', config.apiBaseUrl)` before requests
3. Check environment variables: Verify correct variables are set in `.env` or `.env.local`
4. Check Docker networking: Ensure backend service is named `backend` in `docker-compose.yml`

### Quick Reference

**Always use centralized config:**

```typescript
// apps/frontend/lib/config.ts
import { config, getApiUrl } from '@/lib/config';

config.apiBaseUrl;              // For axios baseURL
config.socketUrl;               // For Socket.IO connection
config.siteUrl;                 // For metadata and redirects
getApiUrl('/path');             // For fetch() in SSR pages
```

**Never access directly:**

```typescript
// ❌ Don't do this - always use config or getRuntimeConfig()
process.env.SITE_BACKEND;
process.env.SITE_URL;
process.env.SITE_WS;
```

**For new API routes:**

1. Add function to `/apps/frontend/lib/api.ts`
2. Use pre-configured `apiClient` instance
3. Export typed functions for features to import

**For new pages with SSR data fetching:**

1. Import `getApiUrl` from `@/lib/config`
2. Use `getApiUrl('/your-endpoint')` with `fetch()`
3. Never hardcode URLs

See [config.ts](../../apps/frontend/lib/config.ts) for the complete implementation.

## Related Documentation

- [Frontend Component Guide](./ui/ui-component-styling.md) - How to style components (CSS Modules, design system, patterns)
- [Legacy Features README](../../apps/frontend/features/README.md) - Documentation for legacy features directory
- [Plugin System](../plugins/plugins.md) - Plugin architecture (separate from modules)
- [Backend Modules](../system/system-modules.md) - Backend modular structure and lifecycle patterns
