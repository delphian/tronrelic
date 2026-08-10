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

### User ids are opaque hex strings

A Better Auth user id is a string — the 24-character hex form of the native MongoDB `ObjectId` the adapter stores as `_id` on `module_user_auth_users`. Treat `req.authSession.user.id` as **opaque**: store it verbatim as a foreign key, compare it verbatim, and never cast it to an `ObjectId` or `$lookup` your own collection directly against the user collection's `_id`. The string↔ObjectId conversion is confined to the identity services that own the user collection (`services/user-id.ts`); everyone else resolves account, wallet, and group data through the `'accounts'` / `'wallets'` / `'user-groups'` service contracts, which return the opaque string. Mixing the two representations — storing the id as a string in one place and an ObjectId in another — silently breaks equality matching.

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

Login-gated REST routes can carry `requiresAuth: true` so the shared `requireLogin` middleware (`api/middleware/require-login.ts`) enforces the gate — 401 for anonymous callers, `req.userId` set for authenticated ones. Admin-gated routes carry `requiresAdmin: true` so `requireAdmin` enforces the gate (it admits a Better Auth admin session or the `ADMIN_API_TOKEN` service token). Both middlewares are available to core routers and plugin route configs alike. See [plugins-api-registration.md](../plugins/plugins-api-registration.md).

### Narrowing an admin route to a human — `requireAdminUser`

`requireAdmin` deliberately admits two unlike callers under one name: a signed-in member of the `admin` group, and anything holding `ADMIN_API_TOKEN`. That is the right trade almost everywhere, but a few endpoints are too consequential to key on a shared secret — handing back a stored secret in plaintext, or removing a safety gate. A single environment variable lives in CI config, a deployment `.env`, and somebody's shell history at once, and the token path sets no `req.userId`, so the audit trail can record *that* the action happened but never *who* did it.

`requireAdminUser` (`api/middleware/admin-auth.ts`) closes that gap for individual routes. Mount it **immediately after** `requireAdmin` on the route itself — it authenticates nothing of its own, it only inspects the `req.adminVia` verdict `requireAdmin` already recorded, so mounting it alone leaves a route wide open. It admits `adminVia === 'user'` with a populated `req.userId` and answers 403 otherwise, which means a handler behind it can rely on having a real actor id to attribute its work to.

**The gate is only half the job — log the actor.** Refusing the shared secret buys little if the action it protects still leaves no record of who performed it, so a handler behind this gate must write `req.userId` into its audit line; the middleware guarantees the id is there. In the AI tools module that is the `adminActionLog` entry in `revealVariable` and in the bulk `listVariables` (each recording variable names and byte sizes, never the values — copying a secret into the log store just moves it to a different queryable surface) and the `actor` field `setOverride` now stamps on every policy change. Attribute the *bulk* read especially: one call there discloses more than the single-variable route it sits beside.

**Gate a capability, not a route.** Narrowing one endpoint accomplishes nothing if the same data has a second door, and a partial boundary is worse than none — it invites the belief that something is contained when it is not. Enumerate every path to the thing you are protecting, then gate the set. In the AI tools module, reading a `secret` prompt variable has six: resolving it directly, the bulk listing (which embeds each static's `content`), a query prompt containing `{%name%}` (the provider expands it before the model sees it), the persisted history of that query's answer, and — because a saved prompt is just a stored query whose registry tokens expand at fire time — saving one or running one. The policy **writes** are gated for a different reason: they remove a safety gate. The matching reads stay on the shared gate, so a monitoring script can still observe a posture it is no longer allowed to change.

Enumeration is the hard part, and it is easy to stop early. The saved-prompt pair above was missed on the first pass and caught in review; the system-prompt writes (`PUT /system-prompts/master`) are a *known* remaining door — a composed system prompt is `{%name%}`-expanded too, so a service token can still plant a secret reference that expands on another principal's later run. Write down what you did not gate, in the code, next to what you did. A comment claiming a boundary is complete is worse than no comment when it is not.

Three honest limits, then. Gating narrows what a token can reach; it does not demote the token, which still opens every other admin route. The set you gate is only as good as your enumeration. And any existing automation calling a narrowed route starts receiving 403 and has to move to a real admin session — grep your CI configs and ops scripts for `x-admin-token` before shipping one of these.

## Further Reading

- [Identity Module README](../../src/backend/modules/identity/README.md) — the module that hosts the Better Auth instance, facade, `GroupService`, the `'user-groups'`/`'wallets'`/`'accounts'` published services, and the wallet store.
- [plugins-api-registration.md](../plugins/plugins-api-registration.md) — gating plugin REST routes (`req.authSession`, predicates, `requiresAdmin`).
- [environment.md](../environment.md) — `BETTER_AUTH_SECRET`, `ADMIN_EMAILS`, `RESEND_*`, OAuth client env vars.
- Source: `src/backend/modules/identity/auth.ts`, `src/backend/modules/identity/services/auth-facade.ts`, `src/backend/modules/identity/services/group.service.ts`, `src/backend/api/middleware/auth-session.ts`; `packages/types/src/auth/`.
