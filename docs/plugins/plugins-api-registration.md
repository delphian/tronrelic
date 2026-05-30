# Plugin API Registration

Plugins expose REST endpoints so the frontend, automation scripts, and third-party tools can work with feature-specific data.

## Why This Matters

The platform isolates each plugin under `/api/plugins/<plugin-id>/`, uses framework-agnostic request/response objects from `@/types`, and ties route lifecycle to plugin enable/disable state. Plugins focus on business logic; the platform handles routing, auth middleware, and error handling. Without the layer, plugins would couple to Express, leak global routes, and outlive their disable state.

## Registration Flow

1. **Plugin loader discovers the plugin** and reads its manifest.
2. **`context.database`, `observerRegistry`, `websocketService`, etc., are injected** into the plugin’s `init` hook.
3. **The plugin exports a `routes` array** describing each endpoint (method, path, handler, optional middleware, auth flags).
4. **`PluginApiService` mounts the routes** under `/api/plugins/<plugin-id>/`.
5. **Express adapts the framework-agnostic handler** to its own primitives behind the scenes.

## Defining Routes

Every route entry uses the `IApiRouteConfig` contract. Focus on these fields:

- `method`: HTTP verb (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
- `path`: URL segment relative to the plugin namespace (`/subscriptions`, `/alerts/:id`).
- `handler(req, res, next)`: async function that reads from the database, performs work, and replies with JSON or an error.
- `middleware`: optional array of `ApiMiddleware` helpers (validation, rate limiting, logging).
- `requiresAuth` / `requiresAdmin`: flip these on to reuse the shared auth guards.
- `description`: short note for generated docs and debugging.

Remember: `req.params`, `req.query`, `req.body`, and `req.ip` are plain objects; `res.status()`, `res.json()`, `res.send()`, and `res.setHeader()` mirror familiar Express methods but stay framework-agnostic.

**`requiresAdmin` runs the admin gate.** The `requireAdmin` middleware admits the call when, in order, (a) the Better Auth session is in the `admin` group, or (b) the request carries `ADMIN_API_TOKEN` via `x-admin-token` / `Authorization: Bearer`. The middleware tags the request with `req.adminVia = 'user' | 'service-token'` so handlers and audit logs can attribute the call. See [system-auth.md](../system/system-auth.md) for the authorization model.

The middleware short-circuits failures with **401**, or **503 when `ADMIN_API_TOKEN` is unset and no admin user resolves** — that 503 is the deliberate "admin surface disabled" signal, not a misconfiguration to retry. See [system-auth.md](../system/system-auth.md) for the canonical specification of the admin authorization model.

The middleware overlaps with `IUserGroupService.isAdmin(req.userId)` — both confirm a human is admin via group membership — but the middleware *also* accepts the service token, while `isAdmin` is a pure predicate the handler consults to vary response shape. Combine them when an admin SPA route both rejects unauthenticated callers and renders different UI per operator: gate with `requiresAdmin: true`, then call the `isAdmin(req)` predicate inside the handler. See [plugins-service-registry.md](./plugins-service-registry.md) and the [Identity Module README](../../src/backend/modules/identity/README.md#published-service-contracts) for the consumption side.

**Auth context is automatically available.** The `attachAuthSession` middleware resolves the Better Auth session onto `req.authSession` before your handler runs. Gate with the synchronous predicates from `@delphian/tronrelic-types` — they read `req.authSession` and act as type guards, so it narrows to non-null on the truthy branch:

- `isLoggedIn(req)` — any authenticated account. Login-only gates.
- `isAdmin(req)` / `isInGroup(req, id)` — role / group-membership gates.
- `hasPrimaryWallet(req)` — the account has a signature-proven primary wallet. **Use this for wallet-gated routes** rather than `isLoggedIn`: a Better Auth account can be email/OAuth/passkey-only with no wallet, so a wallet-gated route must confirm the wallet, not merely a session.

The user id is `req.authSession.user.id`; the canonical wallet is `req.authSession.primaryWallet`. See [system-auth.md](../system/system-auth.md) for the full model.

> **Note.** Gate on `req.authSession` through the predicates above. `req.userId` carries the Better Auth user id that `requireAdmin` sets for audit logging on admin routes.

## Minimal Example

```typescript
import { definePlugin, isLoggedIn, type IHttpRequest, type IHttpResponse, type IHttpNext, type IPluginDatabase } from '@delphian/tronrelic-types';
import { whaleAlertsManifest } from '../manifest.js';

// Mounts at /api/plugins/trp-whale-alerts/subscriptions
export const whaleAlertsBackendPlugin = definePlugin({
    manifest: whaleAlertsManifest,

    init: async ({ database }) => {
        // Lazy initialise request handlers with the injected database
        handlers = createSubscriptionHandlers(database);
    },

    routes: [
        {
            method: 'GET',
            path: '/subscriptions',
            handler: (req, res, next) => handlers.list(req, res, next),
            requiresAuth: true,
            description: 'Fetch subscriptions for the current user'
        }
    ]
});

let handlers: ReturnType<typeof createSubscriptionHandlers>;

function createSubscriptionHandlers(database: IPluginDatabase) {
    return {
        list: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
            try {
                // Auth context resolved by middleware before the handler runs
                if (!isLoggedIn(req)) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                const subscriptions = await database.find('subscriptions', { userId: req.authSession.user.id });
                res.json({ subscriptions });
            } catch (error) {
                next(error);
            }
        }
    };
}
```

The loader reads this configuration, attaches the handler to `GET /api/plugins/trp-whale-alerts/subscriptions`, and takes care of serialising errors if `next(error)` is called.

## Building Middleware

```typescript
const rateLimit = (limit: number, windowMs: number): ApiMiddleware => {
    const hits = new Map<string, number[]>();

    return (req, res, next) => {
        const now = Date.now();
        const windowStart = now - windowMs;
        const ipHits = (hits.get(req.ip) ?? []).filter(timestamp => timestamp > windowStart);

        if (ipHits.length >= limit) {
            return res.status(429).json({
                error: 'Too many requests',
                retryAfterSeconds: Math.ceil((ipHits[0] + windowMs - now) / 1000)
            });
        }

        hits.set(req.ip, [...ipHits, now]);
        next();
    };
};
```

Add it to any route via `middleware: [rateLimit(20, 60_000)]`.

## Step-by-Step Checklist

1. **Decide on the namespace** (`/subscriptions`, `/settings`, etc.) and keep it consistent between REST routes and frontend calls.
2. **Define handlers inside a factory** (e.g., `createHandlers(database)`) so you can share injected services without storing globals.
3. **Use validation middleware** to fail fast and return user-friendly errors.
4. **Call `next(error)` for unexpected failures**—the platform logs and standardises the reply.
5. **Document the contract** (expected params, body, and response shape) in the `description` field or the plugin README.

## Good Practices

- **Return structured JSON** (`{ success: true }`, `{ items, pagination }`) instead of raw arrays or strings.
- **Guard optional features.** If your plugin can be disabled, check configuration at the start of each handler and return `503` if needed.
- **Log with context.** Use shared logging middleware to include `req.method`, `req.path`, `req.ip`, and response time.
- **Avoid synchronous exceptions.** Wrap your logic in `try/catch` or use async helpers so errors bubble to the platform correctly.
- **Keep routes thin.** Delegate heavy lifting to services or queues inside the plugin to avoid blocking requests.

## Quick Reference

| Need                               | Use                                                         |
|------------------------------------|--------------------------------------------------------------|
| Add a new route                    | Push an entry into `routes` with method/path/handler         |
| Require auth/admin                 | Set `requiresAuth: true` or `requiresAdmin: true`            |
| Reuse logic across routes          | Build handler factories and share services via closure       |
| Add validation or rate limiting    | Supply `middleware: [validateBody, rateLimit(...)]`          |
| Send success/error responses       | `return res.status(201).json({ … })`, `next(new Error(message))` |
| Document behaviour                 | Fill in `description` and/or README for the plugin           |
