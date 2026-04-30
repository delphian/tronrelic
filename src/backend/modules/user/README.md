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

| Member | Wire value | Definition |
|--------|-----------|------------|
| `UserIdentityState.Anonymous` | `'anonymous'` | UUID only. No wallets linked. |
| `UserIdentityState.Registered` | `'registered'` | One or more linked wallets; no current verified session (never signed, or the user-level `identityVerifiedAt` clock has aged past `SESSION_TTL_MS`). |
| `UserIdentityState.Verified` | `'verified'` | A wallet was signed within `SESSION_TTL_MS` and the user-level session is still alive. |

`identityState` is an **authoritative stored field**, not a derived view. Mutation handlers (`connectWallet`, `linkWallet`, `unlinkWallet`, `logout`, identity reconciliation) write it exactly once per transition; `toPublicUser` reads it straight through. Verified-session freshness is anchored on a single user-level timestamp, `identityVerifiedAt`, refreshed only by the actions that explicitly renew verification: `linkWallet`, `setPrimaryWallet`, and `refreshWalletVerification`. A signature supplied to authorize `unlinkWallet` does **not** refresh or extend the verified-session clock; unlinking only downgrades state when it removes the wallet basis for the current verification. The TTL is `SESSION_TTL_MS` (14 days) — past that, the next read through `UserService.getById` / `getOrCreate` / `getByWallet` runs `enforceSessionExpiry`, which lazily demotes the user to Registered (or Anonymous if no wallets remain), nulls `identityVerifiedAt`, and persists. So `Verified` on the wire always means "session is currently alive"; a stale Verified document gets corrected on its next read instead of via per-request derivation.

The members are ordered by claim strength (Anonymous → Registered → Verified). Users transition forward when they sign, backward when wallets are unlinked or signatures age. The exported `USER_IDENTITY_STATES` array preserves this order for index-based comparisons.

**Security implication.** `Registered` carries no current cryptographic proof — either unsigned or aged out. Only `Verified` confers proven, current control. Sensitive operations (publishing a public profile, claiming referral rewards, destructive wallet actions) must compare against `UserIdentityState.Verified`, not the per-wallet `verified` historical flag (which stays `true` even after a signature ages out).

**Forbidden pattern — bare string literals.** Do not write `if (state === 'verified')`. Use `if (state === UserIdentityState.Verified)`. Likewise, do not introduce a parallel enum (`UserState`, `IdentityTier`, etc.) — `UserIdentityState` is canonical. The name was chosen to distinguish this concept from the now-retired `isLoggedIn` UI flag (replaced by `identityVerifiedAt` + `SESSION_TTL_MS` in migration 009) and from any future session/connection state.

**Vocabulary mapping to existing API surface.** The HTTP routes and service method names predate this taxonomy and remain unchanged for wire compatibility. The mapping is:

- **"Register a wallet"** is the action that moves a user from `Anonymous` to `Registered`. It is performed by `connectWallet` on the service / `POST /api/user/:id/wallet/connect` on the route.
- **"Verify a wallet"** is the action that moves a user (or a single wallet) into `Verified`. It is performed by `linkWallet` on the service / `POST /api/user/:id/wallet` on the route.
- The `IWalletLink.verified` boolean is the wire-format flag for an individual wallet. `verified: false` contributes to `Registered`; `verified: true` makes the owning user `Verified`.

## Plugin Access to User Data

Plugins have full access to user identity through two mechanisms:

### Request Context (Recommended)

All plugin route handlers receive user context automatically via middleware. The `req.user` and `req.userId` fields are populated before requests reach plugin handlers:

```typescript
import { UserIdentityState } from '@/types';

// In plugin route handler
handler: async (req: IHttpRequest, res: IHttpResponse) => {
    // Cookie present and resolved? (identity continuity, not wallet auth)
    if (!req.user) {
        return res.status(401).json({ error: 'User context required' });
    }

    // Sensitive operations require a live verified session — compare
    // against the canonical taxonomy, never the per-wallet `verified`
    // flag (audit history that stays true after signatures age out).
    if (req.user.identityState !== UserIdentityState.Verified) {
        return res.status(403).json({ error: 'Wallet verification required' });
    }

    const userId = req.userId;
    const wallets = req.user.wallets;
    const preferences = req.user.preferences;
}
```

The middleware parses the `tronrelic_uid` cookie and resolves the user via `UserService`. Plugins don't need to parse cookies or call services directly.

**Security note:** The `tronrelic_uid` cookie is HttpOnly and HMAC-signed by `SESSION_SECRET`, so the UUID is server-issued and unforgeable — but possessing a stable UUID is identity continuity, not proof of wallet ownership. For sensitive operations, always check `req.user.identityState === UserIdentityState.Verified` — the user-level live-session state, with `SESSION_TTL_MS` freshness already enforced by `enforceSessionExpiry`. Frontend plugins consume the same signal as `useUser().isVerified`.

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

**Backend (`src/backend/modules/user/`):**
```
modules/user/
├── index.ts                       # Public API exports
├── UserModule.ts                  # IModule implementation (lifecycle, DI)
├── api/
│   ├── index.ts                   # Barrel exports
│   ├── identity-cookie.ts         # Canonical HttpOnly cookie spec + setter + resolver
│   ├── user.controller.ts         # Request handlers with cookie validation
│   ├── user.routes.ts             # Public, profile, and admin router factories
│   ├── user-group.controller.ts   # Group membership and definition handlers
│   └── user-group.routes.ts       # Admin group router factory
├── database/
│   ├── index.ts                   # Barrel exports
│   ├── IUserDocument.ts           # MongoDB document interface for users
│   └── IUserGroupDocument.ts      # MongoDB document interface for groups
├── services/
│   ├── index.ts                   # Barrel exports
│   ├── auth-status.ts             # Single source of truth for IAuthStatus computation
│   ├── geo.service.ts             # IP → country, referrer parsing, device derivation
│   ├── gsc.service.ts             # Google Search Console keyword integration
│   ├── traffic.service.ts         # ClickHouse traffic_events sibling (PLAN-traffic-events.md)
│   ├── user.service.ts            # Business logic (CRUD, wallet linking, sessions, caching)
│   ├── user.errors.ts             # Service-layer error classes
│   ├── user-group.service.ts      # Group definition CRUD + membership API
│   ├── user-group.errors.ts       # Group-service error classes
│   └── wallet-challenge.service.ts # Single-use nonce mint/consume for wallet mutations
├── migrations/
│   ├── 004_backfill_user_traffic_origins.ts
│   ├── 005_backfill_referral_codes.ts
│   ├── 006_backfill_user_identity_state.ts
│   ├── 007_backfill_user_groups.ts
│   ├── 008_backfill_wallet_verified_at.ts
│   ├── 009_session_identity_verified_at.ts
│   └── 010_create_traffic_events_table.ts  # ClickHouse, target: 'clickhouse'
└── __tests__/
    ├── auth-status.test.ts
    ├── bootstrap.controller.test.ts
    ├── user-group.service.test.ts
    ├── user.service.test.ts
    └── wallet-challenge.service.test.ts
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
│   ├── identity.ts          # Cookie name + UUID validator (server-owned cookie)
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
- **HttpOnly:** true (not exposed to JavaScript)
- **Signed:** true — HMAC-signed with `SESSION_SECRET` via cookie-parser. On the wire the value is `s:<uuid>.<HMAC>`; cookie-parser verifies on read and exposes the unsigned UUID via `req.signedCookies[name]`. Forged values surface as `false` and are rejected.
- **SameSite:** Lax
- **Secure:** true in production (HTTPS only)
- **Path:** /
- **Max-Age:** 1 year (31536000 seconds)

**Server is the only writer.** The server mints the UUID at the bootstrap endpoint, refreshes max-age on each bootstrap, and re-anchors the cookie when identity-swap reconciliation produces a new canonical UUID. The legacy JS UUID generator and localStorage mirror have been removed.

**Bootstrap is Mongo-read-only; first write happens in `startSession`.** Phase 2 of the traffic-events split (see [PLAN-traffic-events.md](../../../../PLAN-traffic-events.md)) made `POST /api/user/bootstrap` mint the cookie and emit one ClickHouse `traffic_event`, but never write to the `users` collection. The first Mongo write is the upsert inside `startSession` (Phase 3) — the first cookie-validated mutation that proves the visitor honors cookies and runs JavaScript. Pre-Phase-2 every cookieless GET (search-engine crawlers, link unfurlers, uptime probes) wrote an empty user row; that traffic is still tracked, but in ClickHouse `traffic_events` rather than the identity collection. `GET /api/user/:id` returns 404 when no row exists for the cookie-resolved UUID; `getServerUser` already maps 404 onto the unauthenticated shell, and `userContextMiddleware` proceeds with `req.user` undefined — both pre-existing graceful-degradation paths the orphan-row fix relies on.

**Why signing matters.** HttpOnly only blocks JavaScript reads in browsers — non-browser clients (curl, custom tools) can set arbitrary `Cookie` headers. Without a signature, an attacker who learns a UUID could forge `Cookie: tronrelic_uid=<uuid>` and pass identity checks. Signing requires possession of `SESSION_SECRET` to mint a valid value, so the cookie behaves as a server-bound bearer token, not a guess-the-UUID lottery.

**Reader policy.** `requireAdmin` reads identity **only** from `req.signedCookies` — a forged or unsigned admin cookie is never honored. Every other HTTP entry point (the bootstrap controller, `validateCookie`, `userContextMiddleware`) shares a single resolver, `resolveIdentityFromCookies` in `identity-cookie.ts`, which prefers `req.signedCookies` and falls back to `req.cookies` for unsigned legacy values; on a fallback each of those readers immediately re-issues the cookie as signed via `setIdentityCookie` and emits an info-level `event: 'legacy_cookie_upgraded'` log so operators can track grace-window decay and flag anomalous patterns. Visitors holding unsigned cookies upgrade transparently on the very next request without losing their UUID. The websocket handshake parser verifies the HMAC directly via `cookie-signature.unsign` (Socket.IO doesn't run cookie-parser) and is **signed-only — no legacy fallback.** The handshake has no Set-Cookie channel, so it cannot facilitate the upgrade; accepting unsigned identity would only let a forged-UUID Cookie header subscribe to identity rooms without possessing `SESSION_SECRET`. Browser visitors always reach the handshake with a signed cookie because `SocketBridge` defers the WS connection past hydration, by which point `UserIdentityProvider` has re-anchored the cookie via `/api/user/bootstrap` — so the signed-only policy never breaks legitimate visitors. Non-browser clients must hit any HTTP entry point first to receive the signed cookie, then connect.

**SESSION_SECRET.** Required in production: env validation throws on startup if unset. Development and test fall through to a fixed placeholder with a console.warn — never deploy with the placeholder.

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

// Mint a wallet challenge, then verify the signed message
const challenge = await userService.issueWalletChallenge(userId, 'link', 'TXyz...');
const signature = await tronWeb.trx.signMessageV2(challenge.message);
const user = await userService.linkWallet(userId, {
    address: 'TXyz...',
    message: challenge.message,
    signature,
    nonce: challenge.nonce
});

// Update preferences
const user = await userService.updatePreferences(userId, {
    theme: 'dark',
    notifications: true
});

// Record a page visit in the active session (creates a session if none exists)
await userService.recordPage(userId, '/markets');

// Extend the active session without a page event
await userService.heartbeat(userId);

// Admin: List users with pagination
const users = await userService.listUsers(50, 0);

// Admin: Search by UUID or wallet
const users = await userService.searchUsers('TXyz...', 20);
```

### UserController (HTTP Interface)

UserController exposes REST API endpoints with cookie validation middleware for public routes and admin token authentication for admin routes.

**Cookie validation middleware:**

The `validateCookie` middleware ensures the `tronrelic_uid` cookie matches the `:id` parameter in the URL. This prevents UUID enumeration attacks and ensures users can only access their own data. Identity resolution flows through the shared `resolveIdentityFromCookies` helper in `identity-cookie.ts` — the single source of truth for the signed-first / unsigned-fallback policy used by every HTTP entry point. Legacy unsigned holders are upgraded on the response so the fallback is genuinely temporary, not a permanent shadow path for clients that bypass `/api/user/bootstrap`.

```typescript
validateCookie(req: Request, res: Response, next: NextFunction): void {
    const resolved = resolveIdentityFromCookies(req);

    if (!resolved) {
        res.status(401).json({ error: 'Unauthorized', message: 'Missing identity cookie' });
        return;
    }

    if (resolved.userId !== req.params.id) {
        res.status(403).json({ error: 'Forbidden', message: 'Cookie does not match requested user ID' });
        return;
    }

    // Upgrade legacy unsigned cookies on the response. Signed path is a no-op.
    if (!resolved.signed) {
        setIdentityCookie(res, resolved.userId);
    }

    next();
}
```

**Public endpoints (cookie-validated `:id` routes; bootstrap is the only exception):**
- `POST /api/user/bootstrap` - Idempotent identity entry point (mints HttpOnly cookie if absent, refreshes if present)
- `GET /api/user/:id` - Get or create user by UUID
- `POST /api/user/:id/wallet/connect` - Register wallet without verification (stage 1)
- `POST /api/user/:id/wallet/challenge` - Mint single-use nonce for the next wallet mutation
- `POST /api/user/:id/wallet` - Verify wallet via signature against a fresh `link` nonce (stage 2)
- `DELETE /api/user/:id/wallet/:address` - Unlink wallet (requires signature + `unlink` nonce)
- `PATCH /api/user/:id/wallet/:address/primary` - Set primary wallet (requires signature + `set-primary` nonce)
- `POST /api/user/:id/wallet/:address/refresh-verification` - Refresh `identityVerifiedAt` and the per-wallet `verifiedAt` (requires signature + `refresh-verification` nonce). Narrower equivalent of the link flow; the WalletButton uses link by default
- `PATCH /api/user/:id/preferences` - Update preferences
- `POST /api/user/:id/activity` - Record activity (legacy — prefer the session/page endpoints below)
- `POST /api/user/:id/session/start` - Open or resume the active session (returns existing session if within timeout)
- `POST /api/user/:id/session/page` - Record a page visit in the active session
- `POST /api/user/:id/session/heartbeat` - Extend session duration without recording a page
- `POST /api/user/:id/session/end` - Explicitly close the active session
- `GET /api/user/:id/referral` - Return the user's referral code and referred/converted counts
- `POST /api/user/:id/logout` - End the verified session (downgrade `identityState`, null `identityVerifiedAt`); cookie persists

**Public profile endpoint (no cookie required; `userContextMiddleware` populates `req.userId` for `isOwner` computation):**
- `GET /api/profile/:address` - Public profile lookup by verified wallet address

**Admin endpoints (require admin token via `requireAdmin`):**
- `GET /api/admin/users` - List/filter/search users with pagination
- `GET /api/admin/users/stats` - User counts and wallet aggregates
- `GET /api/admin/users/analytics/*` - Daily visitors, visitor origins, new users, traffic sources, traffic-source details, top landing pages, geo distribution, device breakdown, campaign performance, engagement, conversion funnel, retention, referral overview
- `GET /api/admin/users/analytics/gsc/status` - Google Search Console configuration status
- `POST | DELETE /api/admin/users/analytics/gsc/credentials` - Save / remove GSC service-account credentials
- `POST /api/admin/users/analytics/gsc/refresh` - On-demand GSC data fetch
- `GET /api/admin/users/:id` - Fetch any user (admin bypass of cookie validation)
- `PUT /api/admin/users/:id/groups` - Replace a user's complete group membership (audit-logged)
- `GET | POST /api/admin/users/groups` - List or create group definitions
- `GET | PATCH | DELETE /api/admin/users/groups/:id` - Read / update / delete a group definition
- `GET /api/admin/users/groups/:id/members` - Paginated user-id list for a group (excludes merge tombstones)

### Frontend Identity Utilities

The server is the only writer of `tronrelic_uid`. The frontend never mints a UUID, never writes the cookie, and never mirrors identity in `localStorage` — those code paths were removed. The frontend uses Redux thunks for all client-side reads/mutations and dedicated SSR helpers for server-side reads.

**`modules/user/lib/identity.ts` — read-only client helpers:**
```typescript
// Cookie name used by the SSR helpers in ./server.ts
export const USER_ID_COOKIE_NAME = 'tronrelic_uid';

// UUID v4 format guard (rejects malformed cookie values before forwarding)
isValidUUID(uuid: string): boolean
```

**`modules/user/lib/server.ts` — SSR helpers (read the HttpOnly cookie via `next/headers`):**
```typescript
// Resolve the visitor's UUID from the request cookie during SSR
const userId = await getServerUserId();

// Boolean form of the same check
const hasIdentity = await hasServerUserIdentity();

// Fetch the user record server-side (forwards the cookie to /api/user/:id)
const user = await getServerUser(userId);
```

**`modules/user/api/client.ts` — API client functions consumed by the Redux thunks:**
```typescript
// Direct HTTP wrappers; prefer dispatching the matching thunk in components
const user = await fetchUser(userId);
const challenge = await requestWalletChallenge(userId, 'link', address);
const user = await linkWallet(userId, { address, message, signature, nonce });
const user = await updatePreferences(userId, { theme: 'dark' });
```

Components should dispatch the Redux thunks listed below (`initializeUser`, `linkWalletThunk`, etc.) rather than calling the client functions directly. The thunks own loading/error state and cache invalidation; the client functions exist only as the transport they wrap.

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
- `initializeUser()` - Idempotent identity bootstrap (calls `POST /api/user/bootstrap`); resolves identity from cookie or mints a fresh one server-side
- `connectWalletThunk({ userId, address })` - Register wallet without verification (stage 1)
- `linkWalletThunk({ userId, address, message, signature, nonce })` - Verify and link wallet (stage 2). Caller mints the challenge, prompts TronLink for the signature, then dispatches.
- `unlinkWalletThunk({ userId, address, message, signature, nonce })` - Unlink wallet. Same nonce + signature contract as link.
- `setPrimaryWalletThunk({ userId, address, message, signature, nonce })` - Set primary wallet. Step-up gate over an existing verified wallet.
- `refreshWalletVerificationThunk({ userId, address, message, signature, nonce })` - Refresh `identityVerifiedAt` on an already-verified wallet without going through the link flow's full validation. Uses the `refresh-verification` action-scoped nonce.
- `updatePreferencesThunk({ userId, preferences })` - Merge preference updates
- `logoutThunk(userId)` - End the verified session (downgrade `identityState`, null `identityVerifiedAt`); cookie persists
- `recordActivityThunk(userId)` - Legacy single-bump activity recorder; new code dispatches the session/page tracking calls in `SocketBridge` / `UserIdentityProvider` instead

The challenge round-trip lives at the call site (e.g. `useWallet`, `WalletCard`) rather than inside the thunk so the slice has no TronLink dependency. Callers fetch a challenge with `requestWalletChallenge(userId, action, address)` from `modules/user/api`, sign `challenge.message` with TronLink, then dispatch the thunk with `(challenge.message, signature, challenge.nonce)`.

**Selectors:**
```typescript
// Identity and data
selectUserId(state)            // UUID v4 (null until initializeUser resolves)
selectUserData(state)          // Full IUserData payload (null until first fetch)
selectUserStatus(state)        // 'idle' | 'loading' | 'succeeded' | 'failed'
selectUserError(state)         // Last thunk error message or null
selectUserInitialized(state)   // True after first initializeUser attempt resolves

// Identity-state shortcuts (drive UI gating; freshness is folded into Verified)
selectIdentityState(state)     // UserIdentityState enum value
selectIsAnonymous(state)       // identityState === Anonymous
selectIsRegistered(state)      // identityState === Registered
selectIsVerified(state)        // identityState === Verified

// Wallet data
selectWallets(state)           // Linked wallets array
selectPrimaryWallet(state)     // Primary wallet address (or null)
selectHasWallets(state)        // True iff any wallets linked
selectHasVerifiedWallet(state) // Alias of selectIsVerified — kept for callers reasoning about wallets

// Preferences
selectPreferences(state)       // Preferences object

// TronLink connection state (not session state — see selectIsVerified for that)
selectConnectedAddress(state)    // Currently connected TronLink address (or null)
selectConnectionStatus(state)    // WalletConnectionStatus enum
selectProviderDetected(state)    // True if TronLink injected
selectConnectionError(state)     // Last connection-flow error message or null
selectIsWalletConnected(state)   // True iff TronLink is connected
selectWalletVerified(state)      // True iff the connected wallet has been verified by signature in this flow
selectWalletLoginRequired(state) // True when connect surfaced loginRequired (wallet belongs to another UUID)
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

**Identity is resolved from the cookie at handshake time, not from the subscribe payload.** Socket.IO forwards the HTTP `Cookie` header on the WebSocket upgrade when the client opts in with `withCredentials: true`. The server parses `tronrelic_uid` once on connection, stashes it on `socket.data.userId`, and uses that — never `payload.user.userId` — when joining identity-scoped rooms. Clients send `{ user: true }` as a sentinel to opt the socket into its own room.

**Backend subscription handling:**
```typescript
// In websocket.service.ts
if (payload.user) {
    const cookieUserId = socket.data.userId; // resolved at connection time
    if (cookieUserId) {
        socket.join(`user:${cookieUserId}`);
    }
}
```

This closes a prior trust gap where any client that learned a UUID could subscribe to that user's `user:<uid>` room by sending it in the payload — the server never consulted the cookie.

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
// Sentinel opt-in — server resolves the UUID from the cookie.
socket.emit('subscribe', { user: true });

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
    identityVerifiedAt: Date | null;     // User-level session clock; null when !Verified
    wallets: IWalletLink[];              // Linked TRON wallets
    preferences: IUserPreferences;       // User settings
    activity: IUserActivity;             // Tracking data
    groups: string[];                    // Admin-defined group memberships (group ids)
    referral: IReferral | null;          // Referral code + attribution; null until first verification or referral arrival
    mergedInto?: string | null;          // Tombstone pointer to canonical UUID after reconciliation
    createdAt: Date;
    updatedAt: Date;
}
```

`identityState` is stored, not derived — UserService writes it on every state transition so all consumers read the field directly. `identityVerifiedAt` anchors the verified-session clock (see `SESSION_TTL_MS` and the `enforceSessionExpiry` flow above). `groups` holds group ids from the `module_user_groups` collection and is mutated only via `IUserGroupService`. Migrations 006 and 007 backfill `identityState` and `groups` on legacy documents; migration 008 backfills per-wallet `verifiedAt`; migration 009 introduces `identityVerifiedAt` and retires the legacy `isLoggedIn` flag.

**Indexes:**
- `id` (unique) - Fast lookup by UUID, prevents duplicates
- `wallets.address` - Find users by linked wallet address
- `activity.firstSeen` - Sort/filter by first-visit date for new-user analytics
- `activity.lastSeen` - Sort by recency for admin queries
- `activity.sessions.startedAt` - Session-level analytics aggregations after `$unwind`
- `activity.sessions.endedAt` - Live-now filter and session-end queries
- `identityState` - Filter users by canonical taxonomy in admin queries
- `groups` - Fast membership lookups for `isMember` / `isAdmin`
- `referral.code` (unique, sparse) - Reverse lookup of referrers by code; sparse since codes only mint at first verification
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
- Store injected dependencies (database, cache, menu service, app, scheduler, service registry, system config, optional ClickHouse)
- Initialize UserService singleton with `setDependencies()` and create its indexes
- Initialize GscService singleton; inject into UserService for keyword enrichment
- Initialize TrafficService singleton (no-ops when `CLICKHOUSE_HOST` is unset); inject into UserService for first-touch backfill on `startSession`
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

**Cookie-based validation** - Public endpoints require `tronrelic_uid` cookie to match the `:id` parameter. Prevents UUID enumeration and ensures users can only access their own data.

**Server-issued wallet challenges** - Wallet mutations (link, unlink, set-primary) require a fresh server-minted nonce in addition to a TronLink signature. The client posts `(action, address)` to `POST /api/user/:id/wallet/challenge`, receives a single-use nonce plus the canonical message to sign, signs the message verbatim with TronLink, and submits `(message, signature, nonce)` to the matching wallet endpoint. The server reconstructs the expected canonical message from `(action, normalizedAddress, nonce)` for strict equality, verifies the signature, then atomically consumes the nonce. Nonces have a 60-second TTL, are scoped per `(userId, action, normalizedAddress)`, and cannot be replayed across actions, addresses, users, or themselves. Replaces the legacy 5-minute client-supplied timestamp window — the client no longer controls the freshness signal.

**Step-up authentication on `setPrimaryWallet`** - Setting a primary wallet requires a fresh `set-primary` challenge and signature, not just the cookie. The cookie is XSS-stealable, and the primary wallet drives downstream attribution (referrals, public profile, plugin reads) — a captured cookie should not steer those flows. The wallet must already be linked; `set-primary` is a step-up gate over an existing verified wallet, not a path to add new ones.

**Admin authentication — dual-track.** Admin endpoints accept *either* of two authorization paths, evaluated in this order:

1. **User path (preferred for human operators)** — the `tronrelic_uid` cookie identifies the caller, the user reads as `identityState === Verified` (freshness is folded in by `enforceSessionExpiry`, the lazy demote-on-read pass that runs inside `UserService.getById`), and `IUserGroupService.isAdmin(userId)` confirms admin-group membership. The middleware sets `req.adminVia = 'user'`; audit logs record the operator's UUID via `req.userId`. Two checks, no separate freshness gate — a user whose `identityVerifiedAt` has aged past `SESSION_TTL_MS` is demoted to `Registered` on the next read and fails the verified check the same way an unsigned-claim user does.

2. **Service-token path (CI, scripts, first-admin bootstrap)** — `ADMIN_API_TOKEN` via `x-admin-token` header or `Authorization: Bearer`. The middleware sets `req.adminVia = 'service-token'`. No per-human attribution; audit logs note this fact explicitly.

The cookie path is tried first so a request that carries both a valid cookie and a service token is attributed to the human operator. A stale-collapsed cookie carries no authority, so a request with both a stale cookie and a valid service token is attributed to the service-token caller — that's the truthful description of what authorized the call. When the cookie path fails and `ADMIN_API_TOKEN` is unset, the middleware returns 503 (admin disabled); when it's set but doesn't match, 401 with no `reason` field.

**Multi-wallet rule — any-signature-keeps-session-alive.** Signing any linked wallet stamps the user-level `identityVerifiedAt` clock via `markVerifiedSession`, so a user with multiple wallets stays `Verified` as long as the most recent signature on *any one* of them is within `SESSION_TTL_MS`. Per-wallet `verifiedAt` is retained as audit history (and drives primary-wallet selection plus the re-verify-after-logout policy in `linkWallet`), but the freshness predicate reads only the single user-level clock. Requiring every linked wallet to be re-signed each window would train operators to click through signature prompts without reading them — worse UX than no expiry at all.

**Recovery flow.** Stale-collapsed users (admin or not) recover through the same surface a never-signed registered user does: the wallet button in the page header. Clicking it prompts a fresh signature on any attached wallet via the link flow, which calls `markVerifiedSession` to stamp a fresh `identityVerifiedAt` and set `identityState = Verified` directly. There is no special "stale admin" UI, no `verification_stale` reason code, and no `/profile` redirect — the affordance disappearing is the signal, the WalletButton is the recovery, and the System nav reappears once the signature lands. Operators who specifically want to re-sign without going through the full link flow can call `POST /api/user/:id/wallet/:address/refresh-verification` directly; the WalletButton uses the link flow because it's already wired and produces an identical session-clock update.

**Bootstrapping the first admin.** A fresh install has no human admins yet. Use the service token to add yourself:

```bash
# After connecting + verifying your wallet via the header WalletButton, look up your UUID
# (visible in /system/users once you have admin, or via the cookie value).
curl -X PUT https://your-domain/api/admin/users/<your-uuid>/groups \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"groups": ["admin"]}'
```

After that, you authenticate via the cookie path on every subsequent request — the service token is needed only for CI, deployment automation, and recovery. If the service token leaks, rotate it; human admins are unaffected because they don't depend on it.

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

**Wallet operations require signatures plus a fresh nonce** - All wallet mutations (link, unlink, set-primary) require both cryptographic signature verification and a server-issued nonce minted via the wallet challenge endpoint. The nonce is single-use and bound to (userId, action, normalizedAddress); a captured signed message cannot be replayed against any of the three operations.

**Admin bypass** - Admin endpoints can access any user data without cookie validation when called via the service-token path. Cookie-path admin calls still attribute the request to a specific operator UUID. Protect the `ADMIN_API_TOKEN` carefully — it remains a high-value secret used by CI and recovery flows.

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

After reconciliation the *server* sets the cookie to the winner's UUID via Set-Cookie on the link-wallet response (the client cannot write the HttpOnly cookie). The frontend triggers a full page reload to reset Redux state, WebSocket subscriptions, and all cached data; the next request then carries the canonical cookie.

### Merge Pointer Resolution

When `getById()` or `getOrCreate()` encounters a document with `mergedInto` set, it follows the pointer to the canonical UUID in a single hop (chains are flattened during merge, so multi-hop resolution is never needed). This handles the case where a user returns with a stale cookie — the backend transparently resolves to the correct identity and the frontend's `initializeUser` thunk detects the ID mismatch and silently updates local storage.

### Data Semantics

The loser UUID's wallets are transferred to the winner. The loser's preferences, activity history, and referral data remain on the tombstone record (not merged). Users are warned through the UI that settings on an *anonymous* or *registered* identity are at risk — only the *verified* state survives a browser change. The tombstone record is retained as a pointer so that any existing references to the loser UUID (in plugin collections, activity logs, etc.) can still resolve to the canonical identity.

### Database Schema

The `mergedInto` field is an optional string on `IUserDocument`. A sparse index on `mergedInto` enables efficient pointer chain flattening via `updateMany({ mergedInto: loserId })` during reconciliation.

## REST API Reference

### Public Endpoints

Most public endpoints require cookie validation — the `tronrelic_uid` cookie must match the `:id` parameter. The bootstrap endpoint is the exception (it mints the cookie). Rate limits are applied per IP address.

**Bootstrap Identity** *(10 req/min)* — Idempotent. The single entry point for visitors. Mints a UUID and sets the HttpOnly cookie when none is present; refreshes max-age and resolves merge tombstones when one is present. **Mongo-read-only** since the traffic-events split — the first write happens in `startSession`. Emits one ClickHouse `traffic_events` row per call.
```
POST /api/user/bootstrap
Content-Type: application/json

{
    "landingPath": "/markets",
    "utm": { "source": "twitter" },
    "originalReferrer": "https://example.com/post"
}

Response: IUser
Set-Cookie: tronrelic_uid=<uuid>; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=31536000
```

The frontend calls this once on mount via the `initializeUser` thunk; the Next.js middleware (`src/frontend/middleware.ts`) calls it server-to-server when an inbound page request lacks a cookie, so SSR finds an identity on the very first visit. The middleware forwards `User-Agent`, `Referer`, `Accept-Language`, `Sec-CH-UA*`, `Sec-Fetch-*`, and `X-Forwarded-For` plus the JSON body shown above so the backend's `traffic_events` row carries real visitor context (not the Docker bridge IP and Node default UA). The body is capped at 1 KB.

**Get User** *(30 req/min)* — Read-only since Phase 2 of the traffic-events split. Returns 404 when no Mongo row exists for the cookie-resolved UUID (ephemeral anonymous; first write happens in `startSession`).
```
GET /api/user/:id

Response: IUser, or 404 when ephemeral
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

**Issue Wallet Challenge** *(10 req/min)* — Mint a single-use nonce for the next wallet mutation. Required before link, unlink, set-primary, or refresh-verification:
```
POST /api/user/:id/wallet/challenge
Content-Type: application/json

{
    "action": "link" | "unlink" | "set-primary" | "refresh-verification",
    "address": "TXyz..."
}

Response: {
    "nonce": "<48 hex chars>",
    "message": "TronRelic link wallet TXyz... (nonce <48 hex chars>)",
    "expiresAt": 1732646460000
}
```

The nonce expires 60 seconds after issuance, is scoped to `(userId, action, normalizedAddress)`, and is consumed atomically on the matching wallet call. Issuing a new challenge for the same tuple invalidates the previous one.

**Link Wallet** *(10 req/min)* — Stage 2: verify the wallet via signature against a fresh `link` nonce. Moves the user (or the specific wallet) into the *verified* state:
```
POST /api/user/:id/wallet
Content-Type: application/json

{
    "address": "TXyz...",
    "message": "TronRelic link wallet TXyz... (nonce <48 hex chars>)",
    "signature": "0x...",
    "nonce": "<48 hex chars>"
}

Response: IUser (wallet updated to verified: true)
```

**Unlink Wallet** *(10 req/min)* — Requires signature against a fresh `unlink` nonce:
```
DELETE /api/user/:id/wallet/:address
Content-Type: application/json

{
    "message": "TronRelic unlink wallet TXyz... (nonce <48 hex chars>)",
    "signature": "0x...",
    "nonce": "<48 hex chars>"
}

Response: IUser
```

**Set Primary Wallet** *(10 req/min)* — Step-up authentication: requires signature against a fresh `set-primary` nonce. The wallet must already be linked.
```
PATCH /api/user/:id/wallet/:address/primary
Content-Type: application/json

{
    "message": "TronRelic set-primary wallet TXyz... (nonce <48 hex chars>)",
    "signature": "0x...",
    "nonce": "<48 hex chars>"
}

Response: IUser
```

**Refresh Wallet Verification** *(10 req/min)* — Stamps `identityVerifiedAt = now` (user-level session clock) and the per-wallet `verifiedAt = now` on an already-verified wallet without toggling its `verified` flag, adding wallets, or running identity reconciliation. Equivalent to re-signing through the link flow but narrower in effect; the WalletButton uses link by default so this endpoint is reserved for callers that specifically want to refresh freshness without going through link's full validation. Refuses to operate on registered (unsigned) wallets — moving registered → verified is the link path's job.
```
POST /api/user/:id/wallet/:address/refresh-verification
Content-Type: application/json

{
    "message": "TronRelic refresh-verification wallet TXyz... (nonce <48 hex chars>)",
    "signature": "0x...",
    "nonce": "<48 hex chars>"
}

Response: IUser (wallet's verifiedAt updated to now)
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

Legacy single-bump tracker. Prefer the session endpoints below for any new instrumentation.

**Start Session** *(60 req/min)* — Idempotent within the 30-minute inactivity window. Returns the active session if one is alive, otherwise opens a new one. **Upserts the Mongo row** when bootstrap left no record (Phase 3 of the traffic-events split); also queries ClickHouse for the visitor's earliest pre-hydration `bootstrap` event by candidate UUID and prefers those values (device, country, referrer domain, landing page, UTM) over the post-hydration session payload, so a crawler-then-browser sequence attributes to the cookieless first impression. Captures device, country (from IP), screen size, referrer, UTM, and landing page on first session; the user-level `activity.origin` is set once and never overwritten. Emits one ClickHouse `session_start` event:
```
POST /api/user/:id/session/start
Content-Type: application/json

{
    "screenWidth": 1920,
    "landingPage": "/markets",
    "rawUtm": { "source": "twitter", "medium": "social", "campaign": "launch" },
    "bodyReferrer": "https://example.com"
}

Response: IUserSession
```

**Record Page Visit** *(60 req/min)* — Append a page to the active session and bump `activity.lastSeen`. Auto-creates a minimal session if none is active:
```
POST /api/user/:id/session/page
Content-Type: application/json

{
    "path": "/markets/TXyz..."
}

Response: { "success": true }
```

**Heartbeat** *(60 req/min)* — Extend the active session's `durationSeconds` and `activity.lastSeen` without recording a page. No-op when there is no active session:
```
POST /api/user/:id/session/heartbeat

Response: { "success": true }
```

**End Session** *(60 req/min)* — Close the active session explicitly, aggregate its duration into lifetime totals. No-op when there is no active session:
```
POST /api/user/:id/session/end

Response: { "success": true }
```

**Referral Stats** *(30 req/min)* — Return the user's referral code (null until first verification) plus counts of referred users and those who reached `Verified`:
```
GET /api/user/:id/referral

Response: {
    "code": "a1b2c3d4" | null,
    "referredCount": number,
    "convertedCount": number
}
```

**Logout** *(30 req/min)* — End the verified session: downgrade `identityState` to `Registered` (or `Anonymous` if no wallets remain) and null `identityVerifiedAt`. The cookie persists; re-establishing a session requires signing with a historically-verified wallet via `/wallet`:
```
POST /api/user/:id/logout

Response: IUser
```

### Public Profile Endpoint

`GET /api/profile/:address` is mounted under a separate router (`/api/profile`) and does not require cookie validation, but `userContextMiddleware` populates `req.userId` so the controller can compute `isOwner` server-side without echoing the owning UUID over the wire. Only verified wallets resolve to a profile; registered (unsigned) and unknown addresses both return 404.

```
GET /api/profile/:address     (60 req/min)

Response: {
    "address": "TXyz...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "isVerified": true,
    "isOwner": false
}
```

### Admin Endpoints

All admin endpoints require admin authorization via *either*: (a) the `tronrelic_uid` cookie of a verified user in the admin group, or (b) the `ADMIN_API_TOKEN` shared service token via `x-admin-token` header or `Authorization: Bearer`. See [Admin authentication — dual-track](#admin-authentication--dual-track) above.

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

**Analytics suite.** The admin user router exposes thirteen analytics endpoints under `/api/admin/users/analytics/*` (daily visitors, visitor origins, new users, traffic sources, traffic-source details, top landing pages, geo distribution, device breakdown, campaign performance, engagement, conversion funnel, retention, referral overview) plus the GSC integration endpoints under `/api/admin/users/analytics/gsc/*`. Each accepts a date range via the `period` / `startDate` / `endDate` query params (`UserService.resolveAnalyticsRange` owns the vocabulary; presets are `24h`, `7d`, `30d`, `90d`, default `30d`). Responses match the corresponding `IUserService` summary types in `@/types`. The admin dashboard at `/system/users` wires these endpoints into chart and table widgets — see `UsersMonitor.tsx` for the canonical consumer rather than duplicating per-endpoint schemas here.

**Group Definition CRUD.** The admin user-groups router (mounted at `/api/admin/users/groups` before the `/:id` user routes so its specific paths win) exposes `GET /` (list), `POST /` (create), `GET /:id` (read), `PATCH /:id` (update), `DELETE /:id` (delete), and `GET /:id/members` (paginated user-id list). System-flagged rows (the seeded `admin` group) refuse rename/delete; the reserved-admin slug pattern blocks operators from creating new admin-pattern names. See [User Groups and Admin Status](#user-groups-and-admin-status) for the consumption side.

**Replace User Group Membership:**
```
PUT /api/admin/users/:id/groups
Content-Type: application/json

{
    "groups": ["admin", "vip-traders"]
}

Response: { "groups": ["admin", "vip-traders"] }
```

Set semantics — the body's `groups` array becomes the user's complete membership. Unknown group ids and unknown users both return 404 (mapped from `UserGroupNotFoundError`); a malformed payload returns 400. Audit-logged at info level with `adminVia` (user vs service-token), `requesterUserId` (the operator's UUID for cookie-path calls; `null` for service-token calls), the requester IP, the target user, and the before/after arrays. The `adminVia` tag distinguishes per-human admin actions from automated service-token traffic in the audit trail.

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

The `UserIdentityProvider` handles this automatically. For manual control, dispatch `initializeUser` — it calls `POST /api/user/bootstrap` (which mints the cookie if absent) and populates Redux from the response:

```typescript
import { useDispatch } from 'react-redux';
import { initializeUser } from '@/modules/user';

function MyComponent() {
    const dispatch = useDispatch();

    useEffect(() => {
        // No client-side UUID minting — the bootstrap endpoint resolves
        // identity from the cookie or mints a fresh one server-side.
        void dispatch(initializeUser());
    }, [dispatch]);
}
```

### Frontend: Link Wallet with TronLink

```typescript
import { useSelector, useDispatch } from 'react-redux';
import { selectUserId, linkWalletThunk } from '@/modules/user';
import { requestWalletChallenge } from '@/modules/user/api';

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

        // Mint a server-issued nonce; sign the canonical message verbatim.
        const challenge = await requestWalletChallenge(userId, 'link', address);
        const signature = await tronWeb.trx.signMessageV2(challenge.message);

        dispatch(linkWalletThunk({
            userId,
            address,
            message: challenge.message,
            signature,
            nonce: challenge.nonce
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
import { getServerUserId, getServerUser } from '@/modules/user';

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
- [ ] `tronrelic_uid` cookie set with `HttpOnly: true` via `setIdentityCookie`; client never writes it directly
- [ ] WebSocket subscribe handler reads identity from `socket.data.userId` (cookie-resolved), never from the payload
- [ ] UUID v4 validation enforced in service layer
- [ ] Wallet signature verification uses SignatureService and consumes a fresh nonce via WalletChallengeService
- [ ] All wallet mutation routes (link, unlink, set-primary, refresh-verification) require a `nonce` field; legacy `timestamp` field has been removed
- [ ] `IWalletLink.verifiedAt` populated on every link / set-primary / refresh-verification success path; legacy rows backfilled by migration 008
- [ ] `UserService.toPublicUser` reads stored `identityState` and `identityVerifiedAt` straight through (authoritative fields, never derived); freshness is enforced by `enforceSessionExpiry` on every materializing read (`getById` / `getOrCreate` / `getByWallet`)
- [ ] `requireAdmin` cookie path checks `identityState === Verified && IUserGroupService.isAdmin(userId)` and nothing else; freshness is folded into `Verified`, no separate gate
- [ ] Cookie validation middleware applied to all `/api/user/:id/*` routes
- [ ] Admin routes protected by `requireAdmin` middleware (dual-track: cookie+verified+admin-group OR service token)
- [ ] First admin bootstrapped via `PUT /api/admin/users/:id/groups` with the service token; subsequent operators added via the cookie path
- [ ] WebSocket subscription for `user:${userId}` room implemented
- [ ] SocketBridge handles `user:update` events
- [ ] UserIdentityProvider placed inside Redux Provider in app providers
- [ ] No client-side writes to `tronrelic_uid` (cookie or localStorage); identity flows from `POST /api/user/bootstrap`
- [ ] SSR utilities use Next.js `cookies()` function (async in Next.js 15)
- [ ] Admin UI registered at `/system/users` via menu service
- [ ] Database indexes created for `id`, `wallets.address`, `activity.lastSeen`
- [ ] Redis cache tags used for user data invalidation

## Troubleshooting

### Cookie Not Being Set

The `tronrelic_uid` cookie is HttpOnly, so `document.cookie` will never show it from JavaScript. That is by design, not a bug. To diagnose missing cookies, check the browser devtools "Application → Cookies" panel or the network tab's `Set-Cookie` headers.

**Common causes:**
- Bootstrap endpoint not reachable from the browser (CORS, backend down, wrong `SITE_BACKEND`)
- `Secure` flag set without HTTPS in production
- SameSite blocking on cross-origin requests
- Next.js middleware bootstrap failed silently — check server logs for fetch errors against `/api/user/bootstrap`

**Resolution:**
```bash
# Verify the bootstrap endpoint sets the cookie correctly
curl -i -X POST http://localhost:4000/api/user/bootstrap -H 'Content-Type: application/json' -d '{}'
# Expect: Set-Cookie: tronrelic_uid=<uuid>; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000
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
The cookie is server-minted at `/api/user/bootstrap` — clients should not synthesise UUIDs. Dispatch `initializeUser()` (which calls bootstrap), then read `selectUserId(state)` from Redux for any subsequent `/api/user/:id/...` request. The `:id` path segment must match the value from the bootstrap response, which is the same UUID the server bound to the cookie.

### Wallet Link Fails with Signature Error

**Diagnosis:**
```json
{"error":"Failed to link wallet","message":"Wallet challenge expired or already used. Request a new challenge."}
```

or

```json
{"error":"Failed to link wallet","message":"Signed message does not match the canonical challenge form."}
```

**Common causes:**
- Nonce expired (60-second TTL elapsed between challenge issuance and submission)
- Nonce already consumed (single-use; retrying after success requires a new challenge)
- Client modified the message before signing instead of signing the canonical form verbatim
- Address mismatch — challenge minted for one address but a different wallet signed
- Action mismatch — `link` nonce submitted to the unlink or set-primary endpoint

**Resolution:**
```typescript
// Always mint a fresh challenge immediately before signing.
const challenge = await requestWalletChallenge(userId, 'link', address);

// Sign the canonical message verbatim — do not modify or rebuild it.
const signature = await tronWeb.trx.signMessageV2(challenge.message);

// Submit within 60 seconds. Use the nonce from the challenge response.
await dispatch(linkWalletThunk({
    userId,
    address,
    message: challenge.message,
    signature,
    nonce: challenge.nonce
}));
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

