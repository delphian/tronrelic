# Plugin API Registration

Plugins expose REST endpoints so the frontend, automation scripts, and third-party tools can work with feature-specific data. The API registration layer keeps those endpoints isolated under `/api/plugins/<plugin-id>/` and forces every handler to use framework-agnostic request/response objects. Plugins focus on business logic while the platform handles routing, auth middleware, and error handling.

## Why the API Layer Matters

- **Feature isolation.** Each plugin owns its namespace and cannot collide with core routes or other plugins.
- **Framework independence.** Handlers use `IHttpRequest`, `IHttpResponse`, and `IHttpNext` from `@tronrelic/types`, so we can swap Express for another HTTP server without touching plugin code.
- **Consistent lifecycle.** Routes register when the plugin loads, reuse the same dependency-injected context, and automatically clean up when a plugin is removed.
- **Centralised middleware.** Auth, rate limiting, validation, and logging follow one shape (`ApiMiddleware[]`), making it easy to share helpers.

## Registration Flow

1. **Plugin loader discovers the plugin** and reads its manifest.
2. **`context.database`, `observerRegistry`, `websocketService`, etc., are injected** into the plugin’s `init` hook.
3. **The plugin exports a `routes` array** describing each endpoint (method, path, handler, optional middleware, auth flags).
4. **`PluginApiService` mounts the routes** under `/api/plugins/<plugin-id>/`.
5. **Express adapts the framework-agnostic handler** to its own primitives behind the scenes.

## Defining Routes with Plain English

Every route entry uses the `IApiRouteConfig` contract. Focus on these fields:

- `method`: HTTP verb (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
- `path`: URL segment relative to the plugin namespace (`/subscriptions`, `/alerts/:id`).
- `handler(req, res, next)`: async function that reads from the database, performs work, and replies with JSON or an error.
- `middleware`: optional array of `ApiMiddleware` helpers (validation, rate limiting, logging).
- `requiresAuth` / `requiresAdmin`: flip these on to reuse the shared auth guards.
- `description`: short note for generated docs and debugging.

Remember: `req.params`, `req.query`, `req.body`, and `req.ip` are plain objects; `res.status()`, `res.json()`, `res.send()`, and `res.setHeader()` mirror familiar Express methods but stay framework-agnostic.

**User context is automatically available.** Middleware populates `req.userId` (from the `tronrelic_uid` cookie) and `req.user` (the resolved user record) before your handler runs. For feature gating, check wallet states:
- `req.user?.wallets?.length > 0` — user has linked a wallet (may be unverified)
- `req.user?.wallets?.some(w => w.verified)` — user has a verified wallet (recommended for feature gating)

See [User Module](../system/system-modules-user.md#plugin-access-to-user-data) for complete patterns.

## Minimal Example

```typescript
import { definePlugin, type IHttpRequest, type IHttpResponse, type IHttpNext } from '@tronrelic/types';
import { whaleAlertsManifest } from '../manifest.js';

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
                // User context populated by middleware before handler runs
                if (!req.user) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                const subscriptions = await database.find('subscriptions', { userId: req.userId });
                res.json({ subscriptions });
            } catch (error) {
                next(error);
            }
        }
    };
}
```

The loader reads this configuration, attaches the handler to `GET /api/plugins/whale-alerts/subscriptions`, and takes care of serialising errors if `next(error)` is called.

## Building Middleware in Plain English

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

By leading with “why” and keeping the handler contract small, plugins can publish durable APIs without worrying about the HTTP server underneath. Define routes declaratively, lean on middleware for cross-cutting concerns, and let the platform keep everything under the right namespace. The result: predictable endpoints, happy clients, and no accidental coupling to Express.

