# Authentication & Authorization

Identity and access control run on [Better Auth](https://better-auth.com). A visitor signs in with email-OTP, OAuth, or a passkey; the server resolves that session once per request and exposes it as `req.authSession`; modules and plugins gate behaviour through a small set of authorization predicates. This document is the authoritative map of that surface.

## Why This Matters

Auth touches every protected route, admin surface, and wallet-gated plugin feature. Reading session cookies or rolling per-feature "is this user allowed" checks by hand produces inconsistent gating, security holes, and code that breaks when the identity backend changes. The system below funnels every check through one resolved session object and one predicate vocabulary, so a route's access rule is one readable call and the backend can evolve without touching call sites.

Better Auth is the sole identity layer. `req.authSession` — populated once per request by the `attachAuthSession` middleware — is the only identity surface; read it through the `isLoggedIn` / `isInGroup` / `isAdmin` predicates.

## How It Works

### The Better Auth instance

`src/backend/modules/identity/auth.ts` builds the single Better Auth instance, mounted at `/api/auth/*`. It uses the MongoDB adapter, remapping Better Auth's tables to the `module_user_auth_*` collections. Sign-in methods are env-gated: email-OTP loads when Resend credentials are set (console fallback in non-prod), OAuth providers (Google, GitHub) load only when both client id and secret are present, and passkeys are always available. There is no password auth. A `databaseHooks.user.create.after` hook auto-promotes a new signup whose verified email is in `ADMIN_EMAILS` into the `admin` group.

### Session resolution → `req.authSession`

The `attachAuthSession` middleware (mounted in `loaders/express.ts`, ahead of the `/api` router) resolves the Better Auth session once at the top of every request and stores an augmented copy on `req.authSession`. It is non-gating — anonymous requests get `req.authSession = null` and proceed; authorization decisions belong to route handlers. The middleware early-returns on `/api/auth/*` (Better Auth's own handler resolves the session itself), so `req.authSession` is `undefined` only there or in test stubs — never for module or plugin routes, which always run after it.

The augmented session (`IAugmentedSession` in core, the narrowed `IAuthSession` for plugins) carries the Better Auth `user` (id, email, …), the user's `groups`, and the denormalized `primaryWallet`.

### Two predicate surfaces — same vocabulary

Authorization is expressed through predicates, never by poking at session fields. There are two implementations with the same names, for two audiences:

| Surface | Import | Shape | Use from |
|---------|--------|-------|----------|
| Core facade | `modules/identity/services/auth-facade.ts` | **async** `isLoggedIn`/`isAnonymous`/`isInGroup`/`isAdmin` | core modules & middleware |
| Plugin predicates | `@delphian/tronrelic-types` | **sync type guards** `isLoggedIn`/`isAnonymous`/`isInGroup`/`isAdmin`/`hasPrimaryWallet` | plugin route handlers |

The core facade is async because it can resolve the session from cookies when no middleware primed it (tests, non-Express call sites); within a normal request it reads the same cached session the middleware resolved. The plugin predicates are synchronous because plugins always receive a request whose `req.authSession` is already resolved — they are pure reads, dependency-free (no Better Auth import), and act as TypeScript type guards so `req.authSession` narrows to non-null on the truthy branch.

Group membership (including admin) is owned by `GroupService` (`modules/identity/services/group.service.ts`), which reads/writes the `groups` array on the Better Auth user record. `isAdmin` is membership in the reserved `admin` group.

### `isLoggedIn` is not `hasPrimaryWallet`

Better Auth separates *being signed in* from *owning a wallet*. A visitor can authenticate via email-OTP, OAuth, or a passkey with **no TRON wallet linked at all**. Gate accordingly:

- `isLoggedIn(req)` — any authenticated account. Use for login-only gates.
- `isAdmin(req)` / `isInGroup(req, id)` — role/membership gates.
- `hasPrimaryWallet(req)` — the account has a signature-proven primary wallet. **Use this for wallet-gated routes.**

This distinction matters whenever a route guards a wallet-bound action: `isLoggedIn` admits wallet-less email/OAuth accounts, so a wallet-gated route must use `hasPrimaryWallet`. Wallets are linked only after a TronLink signature (see the [Identity Module README](../../src/backend/modules/identity/README.md#wallets--iwalletservice)), so a present `primaryWallet` is a proven wallet.

## Plugin Example

```typescript
import { isLoggedIn, isAdmin, hasPrimaryWallet } from '@delphian/tronrelic-types';

handler: async (req, res) => {
    if (!isLoggedIn(req)) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    // Wallet-gated action: require a proven wallet, not just a login.
    if (!hasPrimaryWallet(req)) {
        return res.status(403).json({ error: 'Linked wallet required' });
    }
    const userId = req.authSession.user.id;        // narrowed: non-null
    const wallet = req.authSession.primaryWallet;   // canonical primary
}
```

Admin-gated REST routes should also carry `requiresAdmin: true` so the `requireAdmin` middleware enforces the gate (it admits a Better Auth admin session or the `ADMIN_API_TOKEN` service token). See [plugins-api-registration.md](../plugins/plugins-api-registration.md).

## Further Reading

- [Identity Module README](../../src/backend/modules/identity/README.md) — the module that hosts the Better Auth instance, facade, `GroupService`, the `'user-groups'`/`'wallets'`/`'accounts'` published services, and the wallet store.
- [plugins-api-registration.md](../plugins/plugins-api-registration.md) — gating plugin REST routes (`req.authSession`, predicates, `requiresAdmin`).
- [environment.md](../environment.md) — `BETTER_AUTH_SECRET`, `ADMIN_EMAILS`, `RESEND_*`, OAuth client env vars.
- Source: `src/backend/modules/identity/auth.ts`, `src/backend/modules/identity/services/auth-facade.ts`, `src/backend/modules/identity/services/group.service.ts`, `src/backend/api/middleware/auth-session.ts`; `packages/types/src/auth/`.
