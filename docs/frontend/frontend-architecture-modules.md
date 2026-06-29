## Module Pattern

Frontend code lives in `src/frontend/modules/<name>/`. The legacy `features/` directory still holds older page-specific code; treat it as read-only and place all new work in `modules/`.

## Why Modules Over Features

Before modules, domain code scattered across `components/`, `store/slices/`, and `hooks/`. Finding all user-related code required grepping three trees, refactoring meant updating imports in dozens of files, and Redux slices drifted from the components that consumed them. Modules colocate components, hooks, slice, API client, types, and a public-API barrel under one directory — find it once, refactor it once.

The frontend module structure intentionally mirrors `src/backend/modules/<name>/` so developers carry one mental model across both codebases.

## Where Code Goes

| Location | Use For |
|----------|---------|
| `src/frontend/modules/<name>/` | New domain code: cross-cutting infrastructure, shared state, components used across unrelated routes, providers wrapping the app |
| `src/frontend/features/<name>/` | Read-only legacy. Existing page-specific code only. Do not add new features here |
| `src/frontend/components/ui/` | Generic primitives only (Button, Card, Badge, Input). No domain logic |
| `src/frontend/components/layout/` | App-level layout shells (NavBar, Footer, BlockTicker) |
| `src/frontend/app/<route>/page.tsx` | Thin route wrapper. Imports from a module and renders. No implementation |
| `src/frontend/app/<route>/_components/` | One-off route-only UI with zero reuse potential. Domain code never goes here |

If the feature is "page-specific and tiny" it can still live in `features/`, but the default is `modules/`.

## Module Directory Layout

```
modules/<name>/
├── components/
│   ├── WidgetCard/
│   │   ├── WidgetCard.tsx
│   │   ├── WidgetCard.module.scss
│   │   └── index.ts
│   └── admin/SomeMonitor/
├── hooks/                       # module-specific hooks
├── api/                         # API client functions
├── lib/                         # helpers, SSR resolvers
├── types/                       # module types
├── slice.ts                     # Redux slice (when the module owns state)
└── index.ts                     # Public API barrel
```

Each component sits in its own folder with colocated `.module.scss`, `.test.tsx`, and `index.ts` barrel. Folder layout is mandatory — flat `Component.tsx` next to `Component.module.css` is the old pattern; migrate it when you touch it.

## Public API Through `index.ts`

Every module exposes its surface through one barrel. Consumers import from the module root, never internal paths.

```typescript
// modules/user/index.ts
export { WalletButton } from './components/WalletButton';
export { SessionProvider, useAuthSession } from './components/SessionProvider';
export { AuthModal } from './components/AuthModal';
export type { ISSRSession } from './lib';
```

Why barrels matter here: importing `'../../user/components/WalletButton/WalletButton'` couples the consumer to the module's internal layout. Move the component, every consumer breaks. Importing `'../../user'` survives every internal refactor.

```typescript
// Good — uses public API
import { WalletButton, useAuthSession } from '../../../modules/user';

// Bad — bypasses public API, couples to internal structure
import { WalletButton } from '../../../modules/user/components/WalletButton/WalletButton';
```

## Thin Route Wrappers

Routes in `app/` import and render — they do not implement. All logic lives in the module.

```typescript
// app/(core)/system/users/page.tsx
'use client';
import { useSystemAuth } from '../../../../features/system';
import { UsersMonitor } from '../../../../modules/user';

export default function SystemUsersPage() {
    const { token } = useSystemAuth();
    return <UsersMonitor token={token} />;
}
```

A page file with 500 lines of component logic is the failure mode this rule prevents. If you need state, hooks, or substantial JSX, the implementation belongs in a module component that the page imports.

## Available Modules and Features

**Modules (primary):**

| Module | Purpose |
|--------|---------|
| `user` | Better Auth login, the `/profile` settings hub (wallet management via TronLink signing, notification preferences), `/system/users` identity dashboards |
| `menu` | Navigation system (PriorityNav, useMenuConfig) |
| `address-labels` | Address labeling and display |
| `scheduler` | Scheduler monitoring UI |

Before adding a new module, list `src/frontend/modules/` and grep for existing components. Reimplementing capabilities that already exist is a common failure mode.

**Features (legacy, read-only):**

| Feature | Purpose |
|---------|---------|
| `accounts` | Account management, bookmarks |
| `transactions` | Transaction feed and details |
| `whales` | Whale transaction tracking |
| `blockchain` | Sync status (state only) |
| `charts` | Reusable chart components |
| `system` | System monitoring contexts and shared admin components |
| `realtime` | WebSocket connection and live data sync |
| `ui-state` | Global UI state (modals, toasts, loading) |

## Component Folder Conventions

Every component is its own folder. The folder is the unit of ownership — delete the folder, delete the component, no orphaned files.

```
ComponentName/
├── ComponentName.tsx
├── ComponentName.module.scss        # SCSS preferred over CSS
├── ComponentName.test.tsx           # Optional
└── index.ts                         # Barrel export
```

Naming: PascalCase for `.tsx` and `.module.scss`, lowercase `index.ts`. The barrel re-exports the component and its prop type:

```typescript
// MarketCard/index.ts
export { MarketCard } from './MarketCard';
export type { MarketCardProps } from './MarketCard';
```

For complex components, expand the folder with `<Name>Utils.ts`, `<Name>Types.ts`, `<Name>Context.tsx` as needed and keep helpers private by omitting them from the barrel.

## Redux Wiring

Each module owns one focused slice. The store imports reducers through module barrels:

```typescript
import menuReducer from '../modules/menu/slice';
import transactionReducer from '../features/transactions/slice';

export const store = configureStore({
    reducer: { menu: menuReducer, transactions: transactionReducer }
});
```

One slice per concern. `appSlice` managing everything is the anti-pattern.

## Pre-Ship Checklist

- [ ] New code in `modules/<name>/`, not `features/` or `components/ui/`
- [ ] Public surface exported through `index.ts`; consumers import from module root
- [ ] Components live in their own folder with colocated `.module.scss` and `index.ts`
- [ ] Route file is a thin wrapper — imports and renders, nothing else
- [ ] Slice has a single focused concern

## Related

- [frontend-architecture.md](./frontend-architecture.md) — Index and overview
- [frontend-architecture-runtime-config.md](./frontend-architecture-runtime-config.md) — Environment variables and runtime config APIs
- [ui-scss-modules.md](./ui/ui-scss-modules.md) — SCSS Module styling workflow
- [react.md](./react/react.md) — SSR + Live Updates pattern
- [Backend Modules](../system/modules/modules.md) — Backend modular structure (parallel mental model)
