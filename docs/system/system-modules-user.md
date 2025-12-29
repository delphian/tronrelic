# User Module

The user module provides visitor identity management, enabling anonymous tracking via UUID with optional upgrade to verified TRON wallet addresses. Users start with client-generated UUIDs stored in cookies/localStorage, can link multiple wallets via TronLink signature verification, and have their preferences and activity tracked across sessions.

## Who This Document Is For

Backend developers implementing identity-aware features, frontend developers integrating wallet connection flows, and maintainers understanding the cookie-based authentication pattern.

## Why This Matters

TronRelic needs to track visitor behavior and preferences without requiring registration. Without the user module:

- **No session continuity** - Users lose preferences and bookmarks on every visit
- **No wallet association** - Cannot link blockchain activity to returning visitors
- **No admin visibility** - Support team cannot debug user-reported issues
- **No personalization** - Cannot remember theme preferences, notification settings, or favorite accounts
- **Complex auth flows** - Would require full authentication system just for basic tracking

The user module solves these problems by providing:

- **Anonymous-first identity** - UUID generated on first visit, no registration required
- **Dual storage** - Cookie for SSR access, localStorage for client-side persistence
- **Multi-wallet support** - One UUID can link to multiple TRON addresses
- **Cookie-based validation** - API endpoints validate cookie matches :id parameter
- **Real-time sync** - WebSocket events push user updates to connected clients
- **Admin dashboard** - View and search users at `/system/users`

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

For operations outside request handlers (observers, scheduled jobs), plugins can use `IUserService` via `IPluginContext`:

```typescript
// In plugin init()
init: async (context: IPluginContext) => {
    const { userService, logger } = context;

    // Look up user by wallet address
    const user = await userService.getByWallet('TXyz...');
    if (user) {
        logger.info({ userId: user.id }, 'Found user for wallet');
    }
}
```

**Available IUserService methods:**
- `getById(id: string): Promise<IUser | null>` - Look up user by UUID
- `getByWallet(address: string): Promise<IUser | null>` - Look up user by wallet address

The `IUser` interface includes `id`, `wallets`, `preferences`, `activity`, and timestamps. The internal `IUserDocument` (with MongoDB-specific fields) stays in the module.

## Architecture Overview

The module follows TronRelic's layered architecture with cookie-based authentication for public endpoints and admin token authentication for admin endpoints.

## File Structure

The user module spans both backend and frontend with parallel directory structures:

**Backend (`apps/backend/src/modules/user/`):**
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

**Frontend (`apps/frontend/modules/user/`):**
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

**Admin UI (`apps/frontend/features/system/`):**
```
features/system/components/UsersMonitor/
├── UsersMonitor.tsx         # Admin dashboard component
├── UsersMonitor.module.css  # Component styles
└── index.ts                 # Barrel export
```

**Route page (`apps/frontend/app/`):**
```
app/(dashboard)/system/users/
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
- `PATCH /api/user/:id/wallet/:address/primary` - Set primary wallet (requires signature)
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
- `setPrimaryWalletThunk({ userId, address, message, signature })` - Set primary wallet (requires signature)
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
    wallets: IWalletLink[];              // Linked TRON wallets
    preferences: IUserPreferences;        // User settings
    activity: IUserActivity;              // Tracking data
    createdAt: Date;
    updatedAt: Date;
}

interface IWalletLink {
    address: string;                     // TRON address (T...)
    linkedAt: Date;                      // When wallet was linked
    isPrimary: boolean;                  // Whether this is primary wallet
    label?: string;                      // Optional user-assigned label
}

interface IUserPreferences {
    theme?: 'light' | 'dark' | 'system';
    notifications?: boolean;
    timezone?: string;
    language?: string;
}

interface IUserActivity {
    lastSeen: Date;
    pageViews: number;
    firstSeen: Date;
}
```

**Indexes:**
- `id` (unique) - Fast lookup by UUID, prevents duplicates
- `wallets.address` - Find users by linked wallet address
- `activity.lastSeen` - Sort by recency for admin queries

**Validation rules:**
- UUID must be valid v4 format (enforced in service layer)
- Wallet address must be valid TRON format
- Wallet signature must verify against address (using SignatureService)
- Only one wallet can be primary per user

## Module Lifecycle

The user module implements the `IModule` interface with two-phase initialization:

**Phase 1: init()** - Prepare module without activation
- Store injected dependencies (database, cache, menu service, app)
- Initialize UserService singleton with `setDependencies()`
- Create database indexes
- Create controller with service reference

**Phase 2: run()** - Activate and integrate with application
- Register menu item in `system` namespace at `/system/users`
- Mount public router at `/api/user` (cookie validation on `:id` routes)
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
// apps/backend/src/index.ts
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

**Wallet operations require signatures** - All wallet mutations (link, unlink, set primary) require cryptographic signature verification. This ensures only the wallet owner can modify wallet relationships, regardless of UUID knowledge.

**Admin bypass** - Admin endpoints can access any user data without cookie validation. Protect the `ADMIN_API_TOKEN` carefully.

### Wallet Verification Trust Model

Wallet linking follows a two-step flow where only the signature provides cryptographic proof of ownership:

| Step | Action | Trust Level | What It Proves |
|------|--------|-------------|----------------|
| **Connect** | `tron_requestAccounts` | Unverified claim | User claims this address (no cryptographic proof) |
| **Verify** | `signMessageV2` | Verified ownership | User controls the private key (cryptographic proof) |

**Why unverified wallets are stored:**

An unverified wallet address is semantically equivalent to an address obtained from TronLink's `tron_requestAccounts`—both are unverified claims without cryptographic proof. The `tron_requestAccounts` call is a technical prerequisite to access TronLink's signing API, not a security step. The signature is the only trust boundary.

**UX principle: No popup before button click.**

TronLink prompts only appear after explicit user action:

1. User clicks "Connect" → TronLink prompts for account access → wallet stored as unverified
2. User clicks to verify → TronLink prompts for signature → wallet marked verified

SSR hydrates linked wallet addresses for display, but no TronLink API calls occur on page load. When the user clicks to verify an SSR-hydrated wallet, `connect()` is called first to ensure TronLink's signing API is accessible, then `verify()` requests the signature. For whitelisted sites, `connect()` returns silently (no popup). For non-whitelisted browsers/devices, both prompts appear sequentially after the single button click.

## REST API Reference

### Public Endpoints

All public endpoints require cookie validation - the `tronrelic_uid` cookie must match the `:id` parameter. Rate limits are applied per IP address.

**Get or Create User** *(30 req/min)*:
```
GET /api/user/:id

Response: IUser
```

**Connect Wallet** *(10 req/min)* - Step 1: Store wallet address without verification:
```
POST /api/user/:id/wallet/connect
Content-Type: application/json

{
    "address": "TXyz..."
}

Response: IUser (wallet added with verified: false)
```

**Link Wallet** *(10 req/min)* - Step 2: Verify wallet ownership via signature:
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

**Set Primary Wallet** *(10 req/min)* - Requires signature:
```
PATCH /api/user/:id/wallet/:address/primary
Content-Type: application/json

{
    "message": "Set primary wallet: 1732646400000",
    "signature": "0x..."
}

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

## Admin UI

The admin dashboard at `/system/users` provides:

- **Statistics overview** - Total users, active today, active this week, users with wallets, total wallet links, average wallets per user
- **User list** - Paginated view with expandable details
- **Search** - Find users by UUID or wallet address
- **User details** - View linked wallets (with primary indicator), preferences, and activity history

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

## Further Reading

**TronRelic module patterns:**
- [system-modules.md](./system-modules.md) - Backend module system architecture and lifecycle patterns
- [system-modules-menu.md](./system-modules-menu.md) - Menu module for navigation management
- [system-modules-pages.md](./system-modules-pages.md) - Pages module as reference implementation

**Related frontend patterns:**
- [frontend.md](../frontend/frontend.md) - Frontend architecture overview
- [react.md](../frontend/react/react.md) - React component and context patterns

**Related backend patterns:**
- [plugins/plugins.md](../plugins/plugins.md) - Plugin system architecture (comparison to modules)
- [environment.md](../environment.md) - Environment variable configuration reference
