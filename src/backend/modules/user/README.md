# User Module

The user module provides visitor identity management, enabling anonymous tracking via UUID with optional upgrade to verified TRON wallet addresses. Users start with client-generated UUIDs stored in cookies/localStorage, can link multiple wallets via TronLink signature verification, and have their preferences and activity tracked across sessions.

## Why This Matters

TronRelic needs to track visitor behavior and preferences without requiring an up-front signup flow. Without the user module:

- **No session continuity** - Users lose preferences and bookmarks on every visit
- **No wallet association** - Cannot link blockchain activity to returning visitors
- **No admin visibility** - Support team cannot debug user-reported issues
- **No personalization** - Cannot remember theme preferences, notification settings, or favorite accounts
- **Complex auth flows** - Would require full authentication system just for basic tracking

The user module solves these problems by providing:

- **Anonymous-first identity** - UUID generated on first visit, no signup required
- **Dual storage** - Cookie for SSR access, localStorage for client-side persistence
- **Multi-wallet support** - One UUID can link to multiple TRON addresses
- **Cookie-based validation** - API endpoints validate cookie matches :id parameter
- **Real-time sync** - WebSocket events push user updates to connected clients
- **Admin dashboard** - View and search users at `/system/users`

## User States — Canonical Taxonomy

Every visitor is in exactly one of three states represented by the **`UserIdentityState`** string-valued enum. Use the enum — never bare string literals — in all type signatures, function parameters, return types, database fields, API responses, and comparisons. Use the matching vocabulary (anonymous / registered / verified) in all documentation, comments, log messages, and admin labels.

```typescript
// packages/types/src/user/IUserIdentityState.ts
export enum UserIdentityState {
    Anonymous = 'anonymous',
    Registered = 'registered',
    Verified = 'verified'
}
```

The string values are the wire format — they appear in MongoDB documents, HTTP responses, logs, and admin URLs unchanged. Member names give consumer code typo-safe references; renames and refactors are compiler-checked.

| Member | Wire value | Definition | Detection from `IUser.wallets` |
|--------|-----------|------------|--------------------------------|
| `UserIdentityState.Anonymous` | `'anonymous'` | UUID only. No wallets linked. | `wallets.length === 0` |
| `UserIdentityState.Registered` | `'registered'` | One or more linked wallets, none cryptographically signed. The wallet claim is unverified. | `wallets.length > 0 && wallets.every(w => !w.verified)` |
| `UserIdentityState.Verified` | `'verified'` | At least one linked wallet has been cryptographically signed, proving control of the private key. | `wallets.some(w => w.verified)` |

The members are ordered by claim strength (Anonymous → Registered → Verified). A user transitions forward as they connect and then sign for wallets, and only transitions back if wallets are explicitly unlinked. The exported `USER_IDENTITY_STATES` array preserves this order for index-based comparisons or iteration.

**Security implication.** `Registered` is an unverified claim — the cookie holder asserts the wallet is theirs, but the backend has no cryptographic proof. Only `Verified` proves private-key control. Sensitive operations (publishing a public profile, claiming referral rewards, destructive wallet actions) must compare against `UserIdentityState.Verified` (or use a `hasVerifiedWallet` helper), not the mere presence of a linked wallet.

**Forbidden pattern — bare string literals.** Do not write `if (state === 'verified')`. Use `if (state === UserIdentityState.Verified)`. Likewise, do not introduce a parallel enum (`UserState`, `IdentityTier`, etc.) — `UserIdentityState` is canonical. The name was chosen to distinguish this concept from `isLoggedIn` (a separate UI/feature gate) and from any future session/connection state.

**Vocabulary mapping to existing API surface.** The HTTP routes and service method names predate this taxonomy and remain unchanged for wire compatibility. The mapping is:

- **"Register a wallet"** is the action that moves a user from `Anonymous` to `Registered`. It is performed by `connectWallet` on the service / `POST /api/user/:id/wallet/connect` on the route.
- **"Verify a wallet"** is the action that moves a user (or a single wallet) into `Verified`. It is performed by `linkWallet` on the service / `POST /api/user/:id/wallet` on the route.
- The `IWalletLink.verified` boolean is the wire-format flag for an individual wallet. `verified: false` contributes to `Registered`; `verified: true` makes the owning user `Verified`.

## Plugin Access to User Data

Plugins have full access to user identity through two mechanisms:

### Request Context (Recommended)

All plugin route handlers receive user context automatically via middleware. The `req.user` and `req.userId` fields are populated before requests reach plugin handlers:

```typescript
// In plugin route handler
handler: async (req: IHttpRequest, res: IHttpResponse) => {
    // Check if user context is present (cookie contained valid UUID)
    // Note: This is identity, NOT authentication - cookie values are client-controlled
    if (!req.user) {
        return res.status(401).json({ error: 'User context required' });
    }

    // Wallet state checks
    const hasLinkedWallet = (req.user.wallets?.length ?? 0) > 0;
    const hasVerifiedWallet = req.user.wallets?.some(w => w.verified) ?? false;

    // For sensitive operations, require cryptographic proof of wallet ownership
    if (!hasVerifiedWallet) {
        return res.status(403).json({ error: 'Wallet verification required' });
    }

    // Access user data directly from request
    const userId = req.userId;
    const wallets = req.user.wallets;
    const preferences = req.user.preferences;
}
```

The middleware parses the `tronrelic_uid` cookie and resolves the user via `UserService`. Plugins don't need to parse cookies or call services directly.

**Security note:** The cookie-based user context is identity, not authentication. The `tronrelic_uid` cookie is client-controlled and contains an unverified UUID. For sensitive operations, always check `hasVerifiedWallet` which indicates the user has cryptographically proven wallet ownership via signature.

### IUserService (For Non-Request Context)

For operations outside request handlers (observers, scheduled jobs), plugins can access user data through two discovery mechanisms. The `IPluginContext.userService` property provides direct access injected at bootstrap. The service registry provides late-binding discovery via `context.services.get<IUserService>('user')`, which is the preferred approach for optional consumers that should gracefully degrade if the User Module is unavailable.

```typescript
// Via service registry (preferred for optional consumers)
const userService = context.services.get<IUserService>('user');
if (userService) {
    const activity = await userService.getActivitySummary();
    context.logger.info({ activeToday: activity.activeToday }, 'User health snapshot');
}

// Via plugin context (always available for enabled plugins)
const user = await context.userService.getByWallet('TXyz...');
```

**Available IUserService methods:**

| Method | Purpose |
|--------|---------|
| `getById(id)` | Look up user by UUID |
| `getByWallet(address)` | Look up user by TRON wallet address |
| `getActivitySummary()` | Aggregate user counts, engagement metrics, 7-day visitor trend |
| `getWalletSummary()` | Wallet adoption rates, verification progress, conversion funnel |
| `getRetentionSummary()` | New vs returning visitors, dormant user count, 7-day retention |
| `getPreferencesSummary()` | Theme distribution, notification opt-in rates |

The `IUser` interface includes `id`, `wallets`, `preferences`, `activity`, and timestamps. The summary return types (`IUserActivitySummary`, `IUserWalletSummary`, `IUserRetentionSummary`, `IUserPreferencesSummary`) are defined in `@/types`. The internal `IUserDocument` (with MongoDB-specific fields) stays in the module.

## User Groups and Admin Status

User groups are lightweight named tags admins attach to users so plugins can gate features on group membership without inventing their own permission models. The user module owns the namespace; plugins own the policy. Group definitions live in MongoDB, are managed through the Groups tab on `/system/users`, and are read by plugins through `IUserGroupService`. A reserved-admin slug pattern (`admin`, `admins`, `administrator(s)`, `super-admin(s)`, `sub-admin(s)`, `superadmin(s)`, `root(s)`) is platform-only — operators cannot create or rename rows matching it, and the seeded `admin` row is flagged `system: true` so the admin UI treats it as read-only.

`UserGroupService` is registered on the service registry as `'user-groups'`. Plugins discover it via `context.services.get<IUserGroupService>('user-groups')` for one-shot reads, or `context.services.watch(...)` when their behavior depends on the service being present over time. The service is platform-provided and always available once the user module has run, so the `undefined` branch of `get()` is a defensive nicety rather than a real degradation path.

```typescript
import type { IUserGroupService } from '@/types';

const groups = context.services.get<IUserGroupService>('user-groups');
if (groups && req.userId && await groups.isAdmin(req.userId)) {
    // Render admin-only UI for the cookie-identified visitor
}
```

**Membership API for plugins:**

| Method | Purpose |
|--------|---------|
| `getUserGroups(userId)` | Return the array of group ids the user belongs to. Empty array for unknown users. |
| `isMember(userId, groupId)` | Test membership. Never throws on missing user or group — returns `false`. |
| `addMember(userId, groupId)` | Idempotent. Throws when the group does not exist (treat as deployment mistake). |
| `removeMember(userId, groupId)` | Idempotent. Removing a non-member is a no-op. |
| `setUserGroups(userId, groupIds)` | Replace the user's complete membership atomically. Throws on unknown groups or missing user. Used by the admin editor; plugins should prefer `addMember` / `removeMember` for single-group transitions. |
| `getMembers(groupId, options?)` | Paginated user-id list for a group. Excludes merged tombstones. |
| `isAdmin(userId)` | True when the user belongs to any system-flagged group whose id matches the reserved-admin pattern. Use this — never compare group ids directly. |

Definition CRUD (`listGroups`, `getGroup`, `createGroup`, `updateGroup`, `deleteGroup`) and group-member listing (`GET /api/admin/users/groups/:id/members`) live under `/api/admin/users/groups`. The admin set-membership endpoint (`PUT /api/admin/users/:id/groups`) is the operator path for promoting users into any group, including the reserved `admin` group. Both routes are `requireAdmin`-gated; the set-membership write audit-logs the before/after id arrays plus the requester IP, since the shared-token model has no per-human attribution. Plugins still mutate membership by calling the service directly from request handlers.

**Two distinct admin checks coexist — do not conflate them.** `IUserGroupService.isAdmin(userId)` is a per-user predicate keyed off the visitor's UUID. Use it from plugin code that runs in a request context (cookie identity is present) when the question is "should this person see admin UI?" The `requireAdmin` middleware in `src/backend/api/middleware/admin-auth.ts` (and the `requiresAdmin: true` flag on `IApiRouteConfig`) is a shared-token gate — the caller must present `x-admin-token` matching `ADMIN_API_TOKEN`. It is for operators, scripts, and CI tooling; there is no user identity involved. A typical admin SPA page combines both: the route handler is protected by `requireAdmin` (token), and the page component uses `groups.isAdmin(req.userId)` to decide which controls to render to a cookie-identified human. Plugins that want per-user admin gating must use `IUserGroupService.isAdmin` — rolling a parallel scheme is the path the JSDoc on the interface explicitly warns against.

**Cache and identity-merge semantics.** Membership writes invalidate the `user:${userId}` cache tag, so `/api/user/:id` reflects group changes immediately rather than waiting on the 1-hour TTL. Every membership method (`isAdmin`, `isMember`, `getUserGroups`, `addMember`, `removeMember`) resolves `mergedInto` pointers, so post-merge lookups hit the canonical user instead of the loser tombstone.

## Architecture Overview

The module follows TronRelic's layered architecture with cookie-based authentication for public endpoints and admin token authentication for admin endpoints.

## File Structure

The user module spans both backend and frontend with parallel directory structures:

**Backend (`src/backend/src/modules/user/`):**
```
modules/user/
├── index.ts                 # Public API exports
├── UserModule.ts            # IModule implementation (lifecycle, DI)
├── api/
│   ├── index.ts             # Barrel exports
│   ├── user.controller.ts   # Request handlers with cookie validation
│   └── user.routes.ts       # Public and admin router factories
├── database/
│   ├── index.ts             # Barrel exports
│   └── IUserDocument.ts     # MongoDB document interface
├── services/
│   ├── index.ts             # Barrel exports
│   └── user.service.ts      # Business logic (CRUD, wallet linking, caching)
└── __tests__/
    └── user.service.test.ts # Unit tests with mocks
```

**Frontend (`src/frontend/modules/user/`):**
```
modules/user/
├── index.ts                 # Barrel exports (all public API)
├── slice.ts                 # Redux state management (actions, thunks, selectors)
├── api/
│   ├── index.ts             # Barrel exports
│   └── client.ts            # API client functions (fetchUser, linkWallet, etc.)
├── components/
│   ├── index.ts             # Barrel exports
│   └── UserIdentityProvider.tsx  # React provider for identity initialization
├── lib/
│   ├── index.ts             # Barrel exports
│   ├── identity.ts          # UUID generation, cookie/localStorage management
│   └── server.ts            # SSR utilities (getServerUserId, getServerUser)
└── types/
    ├── index.ts             # Barrel exports
    └── user.types.ts        # TypeScript interfaces (IUserData, IWalletLink, etc.)
```

**Admin UI (`src/frontend/features/system/`):**
```
features/system/components/UsersMonitor/
├── UsersMonitor.tsx         # Admin dashboard component
├── UsersMonitor.module.css  # Component styles
└── index.ts                 # Barrel export
```

**Route page (`src/frontend/app/`):**
```
app/(core)/system/users/
└── page.tsx                 # Next.js route rendering UsersMonitor
```

**Key architectural patterns:**

1. **Two-phase lifecycle** - `init()` prepares services, `run()` mounts routes and registers menu items
2. **Dependency injection** - All services receive typed dependencies via constructor or `setDependencies()`
3. **Inversion of Control** - Module mounts its own routes using injected `app` instead of returning routers
4. **Cookie validation** - Public endpoints require `tronrelic_uid` cookie to match `:id` parameter
5. **Singleton pattern** - UserService uses `setDependencies()` + `getInstance()` pattern

### Cookie Specification

The user identity cookie has these characteristics:

- **Name:** `tronrelic_uid`
- **HttpOnly:** false (client needs to read for API calls)
- **SameSite:** Lax (allow same-site navigation, block cross-site POST)
- **Secure:** true in production (HTTPS only)
- **Path:** / (available site-wide)
- **Max-Age:** 1 year (31536000 seconds)

**Privacy compliance:** This cookie is classified as "functional/essential" under GDPR because it's necessary for the website to remember user preferences and provide personalized features. No consent banner required.

## Core Components

### UserService (Business Logic)

UserService implements the singleton pattern and orchestrates all user operations. All consumers use the same instance configured once during bootstrap.

**Key characteristics:**
- **Singleton pattern** - One instance shared across the application
- **Public API** - Consumers call methods like `getOrCreate()`, `linkWallet()` directly
- **Bootstrap-only configuration** - Dependencies injected once via `setDependencies()`, then immutable
- **Shared state** - All consumers interact with the same MongoDB collections and cache

**Key responsibilities:**
- **User CRUD** - Create, read, update operations with UUID validation
- **Wallet linking** - Verify TronLink signatures, manage multi-wallet relationships
- **Primary wallet** - Track which wallet is marked as primary
- **Preferences** - Store and update user preferences (theme, notifications, etc.)
- **Activity tracking** - Record page views and last seen timestamps
- **Cache management** - Cache user data in Redis with tag-based invalidation
- **Admin operations** - List, search, and get statistics for admin UI

**Singleton dependency injection pattern:**
```typescript
// Private constructor - cannot instantiate directly
private constructor(
    database: IDatabaseService,       // MongoDB collections
    cacheService: ICacheService,      // Redis cache for user data
    logger: ISystemLogService         // Error tracking
)

// Configure once during bootstrap
static setDependencies(database, cacheService, logger): void

// All consumers use this shared instance
static getInstance(): UserService
```

**Common operations:**
```typescript
// Get or create user by UUID (creates if not exists)
const user = await userService.getOrCreate(userId);

// Link wallet with signature verification
const user = await userService.linkWallet(userId, {
    address: 'TXyz...',
    message: 'Link wallet to TronRelic',
    signature: '0x...',
    timestamp: Date.now()
});

// Update preferences
const user = await userService.updatePreferences(userId, {
    theme: 'dark',
    notifications: true
});

// Record activity (page view)
await userService.recordActivity(userId);

// Admin: List users with pagination
const users = await userService.listUsers(50, 0);

// Admin: Search by UUID or wallet
const users = await userService.searchUsers('TXyz...', 20);
```

### UserController (HTTP Interface)

UserController exposes REST API endpoints with cookie validation middleware for public routes and admin token authentication for admin routes.

**Cookie validation middleware:**

The `validateCookie` middleware ensures the `tronrelic_uid` cookie matches the `:id` parameter in the URL. This prevents UUID enumeration attacks and ensures users can only access their own data.

```typescript
validateCookie(req: Request, res: Response, next: NextFunction): void {
    const cookieId = req.cookies?.['tronrelic_uid'];
    const paramId = req.params.id;

    if (!cookieId) {
        res.status(401).json({ error: 'Unauthorized', message: 'Missing identity cookie' });
        return;
    }

    if (cookieId !== paramId) {
        res.status(403).json({ error: 'Forbidden', message: 'Cookie does not match requested user ID' });
        return;
    }

    next();
}
```

**Public endpoints (require cookie validation):**
- `GET /api/user/:id` - Get or create user by UUID
- `POST /api/user/:id/wallet/connect` - Connect wallet without verification (step 1)
- `POST /api/user/:id/wallet` - Link wallet with signature verification (step 2)
- `DELETE /api/user/:id/wallet/:address` - Unlink wallet (requires signature)
- `PATCH /api/user/:id/wallet/:address/primary` - Set primary wallet (cookie auth only)
- `PATCH /api/user/:id/preferences` - Update preferences
- `POST /api/user/:id/activity` - Record activity

**Admin endpoints (require admin token):**
- `GET /api/admin/users` - List users with pagination and search
- `GET /api/admin/users/stats` - Get user statistics
- `GET /api/admin/users/:id` - Get any user by UUID (admin bypass)

### Frontend Identity Utilities

The frontend includes utilities for UUID generation, cookie management, and API calls.

**lib/userIdentity.ts:**
```typescript
// Generate UUID v4
const id = generateUUID();

// Get or create user ID (checks cookie, then localStorage, then generates)
const userId = getOrCreateUserId();

// API calls
const user = await fetchUser(userId);
const user = await linkWallet(userId, address, message, signature, timestamp);
const user = await updatePreferences(userId, { theme: 'dark' });
```

**lib/serverUserIdentity.ts (SSR):**
```typescript
// Get user ID during server-side rendering
const userId = await getServerUserId();

// Check if user has identity cookie
const hasIdentity = await hasServerUserIdentity();

// Fetch user data during SSR
const user = await getServerUser(userId);
```

### Redux State Management

The user feature includes a Redux slice with async thunks for all operations.

**State shape:**
```typescript
interface UserState {
    userId: string | null;        // UUID
    userData: IUserData | null;   // Full user data from backend
    status: 'idle' | 'loading' | 'succeeded' | 'failed';
    error: string | null;
    initialized: boolean;         // True after first fetch attempt
}
```

**Available thunks:**
- `initializeUser(userId)` - Fetch or create user
- `connectWalletThunk({ userId, address })` - Connect wallet without verification
- `linkWalletThunk({ userId, address, message, signature, timestamp })` - Verify and link wallet
- `unlinkWalletThunk({ userId, address, message, signature })` - Unlink wallet (requires signature)
- `setPrimaryWalletThunk({ userId, address })` - Set primary wallet (cookie auth only)
- `updatePreferencesThunk({ userId, preferences })`
- `recordActivityThunk(userId)`

**Selectors:**
```typescript
selectUserId(state)           // Get user ID
selectUserData(state)         // Get full user data
selectWallets(state)          // Get linked wallets array
selectPrimaryWallet(state)    // Get primary wallet address
selectPreferences(state)      // Get preferences object
selectHasWallets(state)       // Check if any wallets linked
```

### UserIdentityProvider

React provider component that initializes user identity on app mount. Must be rendered inside Redux Provider.

```typescript
// In providers.tsx
<Provider store={store}>
  <ToastProvider>
    <ModalProvider>
      <FrontendPluginContextProvider>
        <SocketBridge />
        <UserIdentityProvider>
          <PluginLoader />
          {children}
        </UserIdentityProvider>
      </FrontendPluginContextProvider>
    </ModalProvider>
  </ToastProvider>
</Provider>
```

**What it does:**
1. Gets or creates user ID from cookie/localStorage
2. Dispatches `initializeUser` thunk to fetch/create user in backend
3. Records activity on successful initialization
4. Subscribes to `user:${userId}` WebSocket room for real-time updates

### WebSocket Integration

The module supports real-time updates via WebSocket.

**Backend subscription handling:**
```typescript
// In websocket.service.ts
if (payload.user?.userId) {
    socket.join(`user:${payload.user.userId}`);
}
```

**Backend emit method:**
```typescript
// Emit user update to connected clients
webSocketService.emitToUser(userId, {
    event: 'user:update',
    payload: userData
});
```

**Frontend handling in SocketBridge:**
```typescript
// Subscribe when userId is available
socket.emit('subscribe', { user: { userId } });

// Handle updates
socket.on('user:update', (payload) => {
    dispatch(setUserData(payload));
});
```

## Database Schema

The module stores data in a single MongoDB collection with indexes for efficient queries.

### users Collection

**Schema:**
```typescript
interface IUserDocument {
    _id: ObjectId;
    id: string;                          // UUID v4 primary identifier
    identityState: UserIdentityState;    // Stored taxonomy: anonymous | registered | verified
    wallets: IWalletLink[];              // Linked TRON wallets
    preferences: IUserPreferences;       // User settings
    activity: IUserActivity;             // Tracking data
    groups: string[];                    // Admin-defined group memberships (group ids)
    mergedInto?: string;                 // Tombstone pointer to canonical UUID after reconciliation
    createdAt: Date;
    updatedAt: Date;
}
```

`identityState` is stored, not derived — UserService recomputes it on every wallet mutation so all consumers read the field directly. `groups` holds group ids from the `module_user_groups` collection and is mutated only via `IUserGroupService`. Migrations 006 and 007 backfill `identityState` and `groups` on legacy documents.

**Indexes:**
- `id` (unique) - Fast lookup by UUID, prevents duplicates
- `wallets.address` - Find users by linked wallet address
- `activity.lastSeen` - Sort by recency for admin queries
- `identityState` - Filter users by canonical taxonomy in admin queries
- `groups` - Fast membership lookups for `isMember` / `isAdmin`
- `mergedInto` (sparse) - Pointer-chain flattening during identity reconciliation

**Validation rules:**
- UUID must be valid v4 format (enforced in service layer)
- Wallet address must be valid TRON format
- Wallet signature must verify against address (using SignatureService)
- Only one wallet can be primary per user

### module_user_groups Collection

Stores admin-defined group definitions. Managed by `UserGroupService`; consumed by plugins via the `'user-groups'` service registry entry. See [User Groups and Admin Status](#user-groups-and-admin-status) for the full API.

**Schema:**
```typescript
interface IUserGroupDocument {
    _id: ObjectId;
    id: string;          // Stable kebab-case slug used by plugins
    name: string;        // Human-readable label
    description: string; // Optional admin description
    system: boolean;     // True for platform-seeded rows (read-only in admin UI)
    createdAt: Date;
    updatedAt: Date;
}
```

**Indexes:**
- `id` (unique) - Slug-based lookup; enforces uniqueness across admin-defined and seeded groups

**Seeded rows:** the user module seeds the `admin` row (with `system: true`) on every boot. The reserved-admin slug pattern (`admin`, `admins`, `super-admin(s)`, `administrator(s)`, `sub-admin(s)`, `superadmin(s)`, `root(s)`) blocks operators from creating or renaming rows matching it — only the platform may seed them.

## Module Lifecycle

The user module implements the `IModule` interface with two-phase initialization:

**Phase 1: init()** - Prepare module without activation
- Store injected dependencies (database, cache, menu service, app, scheduler, service registry, system config)
- Initialize UserService singleton with `setDependencies()` and create its indexes
- Initialize UserGroupService singleton, create its indexes, and seed system groups (the reserved `admin` row)
- Create user and user-group controllers with their service references

**Phase 2: run()** - Activate and integrate with application
- Register menu item in `system` namespace at `/system/users`
- Register UserService on the service registry as `'user'` for late-binding plugin discovery
- Register UserGroupService on the service registry as `'user-groups'` for plugin permission gating
- Mount public router at `/api/user` (cookie validation on `:id` routes)
- Mount admin user-groups router at `/api/admin/users/groups` with `requireAdmin` middleware (mounted before the user admin router so its specific paths win over `/:id`)
- Mount admin router at `/api/admin/users` with `requireAdmin` middleware

**Module metadata:**
```typescript
{
    id: 'user',
    name: 'User',
    version: '1.0.0',
    description: 'Visitor identity management and wallet linking'
}
```

**Integration in backend bootstrap:**
```typescript
// src/backend/src/index.ts
import { UserModule } from './modules/user/index.js';

const userModule = new UserModule();

// Phase 1: Initialize
await userModule.init({
    database: coreDatabase,
    cacheService: cacheService,
    menuService: MenuService.getInstance(),
    app: app
});

// Phase 2: Run
await userModule.run();
```

## Security

The user module implements multiple layers of protection against abuse and unauthorized access.

### Authentication

**Cookie-based validation** - Public endpoints require `tronrelic_uid` cookie to match the `:id` parameter in the URL. This prevents UUID enumeration and ensures users can only access their own data.

**Signature verification** - Wallet mutation operations (link, unlink, set primary) require TronLink signature verification to prove wallet ownership. Signatures include timestamp for replay protection (5-minute expiry window).

**Admin token** - Admin endpoints require `ADMIN_API_TOKEN` via `x-admin-token` header or `Authorization: Bearer` header.

### Rate Limiting

All public endpoints are rate-limited per IP address using Redis-backed sliding window counters:

| Endpoint Category | Limit | Rationale |
|-------------------|-------|-----------|
| **User identity/preferences** | 30 requests/minute | Prevents user creation spam and preference flooding |
| **Activity recording** | 60 requests/minute | Higher limit for legitimate navigation |
| **Wallet mutations** | 10 requests/minute | Strict limit since wallet ops are infrequent |

**Rate limit responses:**
```json
{
    "error": "RATE_LIMIT",
    "message": "Too many requests"
}
```

HTTP status code `429` is returned when rate limit is exceeded.

### Security Considerations

**UUID as "knowledge" factor** - The security model relies on UUIDs being unguessable (122 bits of randomness). If an attacker learns a UUID (via logs, XSS, or user sharing), they can access that user's data by setting their own cookie. This is acceptable for anonymous-first identity but limits what sensitive operations should be tied to UUID alone.

**Wallet operations require signatures** - Destructive wallet mutations (link, unlink) require cryptographic signature verification. Setting primary is a non-destructive preference change among already-verified wallets, so it requires only cookie authentication.

**Admin bypass** - Admin endpoints can access any user data without cookie validation. Protect the `ADMIN_API_TOKEN` carefully.

### Wallet Verification Trust Model

Wallets are added to a user in two stages. Only the signature stage provides cryptographic proof of ownership.

| Stage | TronLink call | Resulting user state | What it proves |
|-------|---------------|----------------------|-----------------|
| **Register** | `tron_requestAccounts` | *registered* (`verified: false`) | User claims this address (no cryptographic proof) |
| **Verify** | `signMessageV2` | *verified* (`verified: true`) | User controls the private key (cryptographic proof) |

**Why registered (unsigned) wallets are stored.**

A registered wallet address is semantically equivalent to an address obtained from TronLink's `tron_requestAccounts` — both are unverified claims without cryptographic proof. The `tron_requestAccounts` call is a technical prerequisite to access TronLink's signing API, not a security step. The signature is the only trust boundary.

**UX principle: No popup before button click.**

TronLink prompts only appear after explicit user action:

1. User clicks "Connect" → TronLink prompts for account access → wallet stored as registered (`verified: false`).
2. User clicks to verify → TronLink prompts for signature → wallet marked verified (`verified: true`).

SSR hydrates linked wallet addresses for display, but no TronLink API calls occur on page load. When the user clicks to verify an SSR-hydrated wallet, `connect()` is called first to ensure TronLink's signing API is accessible, then `verify()` requests the signature. For whitelisted sites, `connect()` returns silently (no popup). For non-whitelisted browsers/devices, both prompts appear sequentially after the single button click.

## Cross-Browser Identity Reconciliation

Anonymous and registered users should expect ephemeral settings — their preferences and data are tied to a browser-local UUID that can be lost if cookies or localStorage are cleared. Wallet signature verification is the only mechanism that bridges identity across browsers or devices, because only a *verified* wallet anchors the user to something portable.

### How It Works

When a user attempts to connect a wallet address that is already claimed by another UUID (in either *registered* or *verified* state), the backend returns `loginRequired: true` and the frontend forces a signature verification. No two UUIDs may share the same wallet address without cryptographic proof of ownership.

Once the signature is verified, identity reconciliation occurs. The UUID that already held the wallet is the "winner" (canonical identity). The calling UUID is the "loser" (merged identity). The reconciliation operation transfers all wallets from the loser to the winner (skipping duplicates), marks the disputed wallet as verified on the winner, creates a tombstone on the loser by setting `mergedInto` to the winner's UUID and clearing its wallets array, and flattens any existing pointer chains so that any UUID already pointing to the loser now points directly to the winner.

After reconciliation the frontend updates cookie/localStorage to the winner's UUID and triggers a full page reload to reset Redux state, WebSocket subscriptions, and all cached data.

### Merge Pointer Resolution

When `getById()` or `getOrCreate()` encounters a document with `mergedInto` set, it follows the pointer to the canonical UUID in a single hop (chains are flattened during merge, so multi-hop resolution is never needed). This handles the case where a user returns with a stale cookie — the backend transparently resolves to the correct identity and the frontend's `initializeUser` thunk detects the ID mismatch and silently updates local storage.

### Data Semantics

The loser UUID's wallets are transferred to the winner. The loser's preferences, activity history, and referral data remain on the tombstone record (not merged). Users are warned through the UI that settings on an *anonymous* or *registered* identity are at risk — only the *verified* state survives a browser change. The tombstone record is retained as a pointer so that any existing references to the loser UUID (in plugin collections, activity logs, etc.) can still resolve to the canonical identity.

### Database Schema

The `mergedInto` field is an optional string on `IUserDocument`. A sparse index on `mergedInto` enables efficient pointer chain flattening via `updateMany({ mergedInto: loserId })` during reconciliation.

## REST API Reference

### Public Endpoints

All public endpoints require cookie validation - the `tronrelic_uid` cookie must match the `:id` parameter. Rate limits are applied per IP address.

**Get or Create User** *(30 req/min)*:
```
GET /api/user/:id

Response: IUser
```

**Connect Wallet** *(10 req/min)* — Stage 1: register the wallet (no signature). Moves the user from *anonymous* to *registered*:
```
POST /api/user/:id/wallet/connect
Content-Type: application/json

{
    "address": "TXyz..."
}

Response: IUser (wallet added with verified: false)
```

**Link Wallet** *(10 req/min)* — Stage 2: verify the wallet via signature. Moves the user (or the specific wallet) into the *verified* state:
```
POST /api/user/:id/wallet
Content-Type: application/json

{
    "address": "TXyz...",
    "message": "Link wallet to TronRelic: 1732646400000",
    "signature": "0x...",
    "timestamp": 1732646400000
}

Response: IUser (wallet updated to verified: true)
```

**Unlink Wallet** *(10 req/min)* - Requires signature:
```
DELETE /api/user/:id/wallet/:address
Content-Type: application/json

{
    "message": "Unlink wallet from TronRelic: 1732646400000",
    "signature": "0x..."
}

Response: IUser
```

**Set Primary Wallet** *(10 req/min)* - Cookie auth only, no signature required:
```
PATCH /api/user/:id/wallet/:address/primary

Response: IUser
```

**Update Preferences** *(30 req/min)*:
```
PATCH /api/user/:id/preferences
Content-Type: application/json

{
    "theme": "dark",
    "notifications": true
}

Response: IUser
```

**Record Activity** *(60 req/min)*:
```
POST /api/user/:id/activity

Response: { "success": true }
```

### Admin Endpoints

All admin endpoints require `x-admin-token` header.

**List Users:**
```
GET /api/admin/users?limit=50&skip=0&search=TXyz

Response: {
    "users": IUser[],
    "total": number,
    "stats": IUserStats
}
```

**Get Statistics:**
```
GET /api/admin/users/stats

Response: IUserStats
```

**Get Any User:**
```
GET /api/admin/users/:id

Response: IUser (or 404 if not found)
```

**Replace User Group Membership:**
```
PUT /api/admin/users/:id/groups
Content-Type: application/json

{
    "groups": ["admin", "vip-traders"]
}

Response: { "groups": ["admin", "vip-traders"] }
```

Set semantics — the body's `groups` array becomes the user's complete membership. Unknown group ids return 400 (mapped from `UserGroupNotFoundError`); unknown users return 404. Audit-logged at info level with target user, requester IP, and before/after arrays.

**List Group Members:**
```
GET /api/admin/users/groups/:id/members?limit=100&skip=0

Response: { "userIds": ["uuid1", "uuid2", ...], "total": number }
```

Paginated user-id list. `limit` defaults to 100, ceiling 500. Excludes merged tombstones.

## Admin UI

The admin dashboard at `/system/users` provides:

- **Statistics overview** - Total users, active today, active this week, users with wallets, total wallet links, average wallets per user
- **User list** - Paginated view with expandable details
- **Search** - Find users by UUID or wallet address
- **User details** - View linked wallets (with primary indicator), preferences, activity history, and current group memberships
- **Group membership editor** - "Manage Groups" action on the expanded user row opens a checkbox list of all defined groups; ticking and saving calls `PUT /api/admin/users/:id/groups`. This is the operator path for promoting a user into the reserved `admin` group
- **Group members audit view** - The Groups tab exposes a per-row "Members" action that lists every user currently in a group, backed by `GET /api/admin/users/groups/:id/members`. Available for system groups too (the `admin` row is the canonical use case)

## Usage Examples

### Frontend: Initialize User Identity

The `UserIdentityProvider` handles this automatically, but for manual control:

```typescript
import { getOrCreateUserId, fetchUser } from '@/lib/userIdentity';
import { useDispatch } from 'react-redux';
import { setUserData } from '@/features/user';

function MyComponent() {
    const dispatch = useDispatch();

    useEffect(() => {
        const userId = getOrCreateUserId();
        fetchUser(userId).then(user => {
            dispatch(setUserData(user));
        });
    }, []);
}
```

### Frontend: Link Wallet with TronLink

```typescript
import { useSelector, useDispatch } from 'react-redux';
import { selectUserId, linkWalletThunk } from '@/features/user';

function WalletConnect() {
    const dispatch = useDispatch();
    const userId = useSelector(selectUserId);

    const handleConnect = async () => {
        const tronWeb = (window as any).tronWeb;
        if (!tronWeb?.defaultAddress?.base58) {
            alert('Please connect TronLink');
            return;
        }

        const address = tronWeb.defaultAddress.base58;
        const timestamp = Date.now();
        const message = `Link wallet to TronRelic: ${timestamp}`;
        const signature = await tronWeb.trx.signMessageV2(message);

        dispatch(linkWalletThunk({
            userId,
            address,
            message,
            signature,
            timestamp
        }));
    };

    return <button onClick={handleConnect}>Connect Wallet</button>;
}
```

### Backend: Access UserService Programmatically

```typescript
import { UserService } from './modules/user/index.js';

// Get singleton instance (after module init)
const userService = UserService.getInstance();

// Get user with wallets
const user = await userService.getOrCreate('uuid-here');
console.log(`User has ${user.wallets.length} wallets`);

// Check if wallet is linked to any user
const userByWallet = await userService.getByWallet('TXyz...');
if (userByWallet) {
    console.log(`Wallet linked to user ${userByWallet.id}`);
}
```

### SSR: Access User During Server Rendering

```typescript
// In a server component
import { getServerUserId, getServerUser } from '@/lib/serverUserIdentity';

export default async function ProfilePage() {
    const userId = await getServerUserId();

    if (!userId) {
        return <p>No user identity found</p>;
    }

    const user = await getServerUser(userId);

    return (
        <div>
            <h1>Welcome back!</h1>
            {user?.wallets.length > 0 && (
                <p>You have {user.wallets.length} linked wallets</p>
            )}
        </div>
    );
}
```

## Pre-Implementation Checklist

Before deploying user module features, verify:

- [ ] Module registered in backend bootstrap with two-phase initialization
- [ ] UserService singleton configured via `setDependencies()` before first use
- [ ] cookie-parser middleware installed and configured in Express
- [ ] UUID v4 validation enforced in service layer
- [ ] Wallet signature verification uses SignatureService
- [ ] Cookie validation middleware applied to all `/api/user/:id/*` routes
- [ ] Admin routes protected by `requireAdmin` middleware
- [ ] WebSocket subscription for `user:${userId}` room implemented
- [ ] SocketBridge handles `user:update` events
- [ ] UserIdentityProvider placed inside Redux Provider in app providers
- [ ] Dual storage (cookie + localStorage) synced on client
- [ ] SSR utilities use Next.js `cookies()` function (async in Next.js 15)
- [ ] Admin UI registered at `/system/users` via menu service
- [ ] Database indexes created for `id`, `wallets.address`, `activity.lastSeen`
- [ ] Redis cache tags used for user data invalidation

## Troubleshooting

### Cookie Not Being Set

**Diagnosis:**
```javascript
console.log(document.cookie);
// Empty or missing tronrelic_uid
```

**Common causes:**
- Script running before DOM ready
- Secure flag set but not on HTTPS
- SameSite issues with cross-origin requests

**Resolution:**
```typescript
// Check production mode detection
const isProduction = window.location.protocol === 'https:';
console.log('Is production:', isProduction);

// Manually set cookie for testing
setUserIdCookie('test-uuid-here');
```

### 401 Unauthorized on API Calls

**Diagnosis:**
```bash
curl http://localhost:4000/api/user/some-uuid
# Returns: {"error":"Unauthorized","message":"Missing identity cookie"}
```

**Cause:**
Cookie not included in request.

**Resolution:**
```typescript
// Ensure withCredentials is set
const response = await apiClient.get(`/user/${userId}`, {
    withCredentials: true
});
```

### 403 Forbidden - Cookie Mismatch

**Diagnosis:**
```bash
curl http://localhost:4000/api/user/some-uuid \
  -H "Cookie: tronrelic_uid=different-uuid"
# Returns: {"error":"Forbidden","message":"Cookie does not match requested user ID"}
```

**Cause:**
The UUID in the URL doesn't match the UUID in the cookie.

**Resolution:**
Ensure the client uses the same UUID from storage for both the cookie and API calls:
```typescript
const userId = getOrCreateUserId(); // Uses same ID for cookie and API
```

### Wallet Link Fails with Signature Error

**Diagnosis:**
```json
{"error":"Failed to link wallet","message":"Invalid signature"}
```

**Common causes:**
- Message format doesn't match expected pattern
- Timestamp too old (check backend validation)
- Signature from different address than provided

**Resolution:**
```typescript
// Ensure message matches backend expectations
const timestamp = Date.now();
const message = `Link wallet to TronRelic: ${timestamp}`;

// Sign with TronLink
const signature = await tronWeb.trx.signMessageV2(message);

// Verify address matches
const address = tronWeb.defaultAddress.base58;
```

### User Data Not Updating in Real-Time

**Diagnosis:**
User links wallet in one tab, but other tabs don't reflect the change.

**Cause:**
WebSocket subscription not established or handler not dispatching update.

**Resolution:**
```typescript
// Check WebSocket connection
const socket = getSocket();
console.log('Connected:', socket.connected);

// Verify subscription
socket.on('user:update', (data) => {
    console.log('Received user update:', data);
});
```

### Admin Stats Show Zero Active Users

**Diagnosis:**
```json
{"totalUsers":100,"activeToday":0,"activeThisWeek":0}
```

**Cause:**
Activity not being recorded (recordActivity not called).

**Resolution:**
Ensure `recordActivityThunk` is dispatched after initialization:
```typescript
// In UserIdentityProvider
dispatch(initializeUser(id)).then((result) => {
    if (result.meta.requestStatus === 'fulfilled') {
        dispatch(recordActivityThunk(id));
    }
});
```

