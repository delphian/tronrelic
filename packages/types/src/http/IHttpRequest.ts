import type { IAuthSession } from '../auth/IAuthSession.js';

/**
 * Framework-agnostic HTTP request interface.
 *
 * This abstraction decouples plugins from Express-specific types, allowing the
 * core framework to potentially swap HTTP libraries in the future without breaking
 * plugins. Plugins work with this interface instead of importing Express directly.
 *
 * Why this abstraction exists:
 * - Plugins remain framework-independent
 * - Backend can swap Express for Fastify, Koa, etc. without plugin changes
 * - Easier testing with mock request objects
 * - Clear contract for what request data is available
 *
 * ## Auth Context
 *
 * The core `attachAuthSession` middleware resolves the Better Auth session
 * onto `req.authSession` before requests reach plugin routes. Gate with the
 * synchronous predicates from `@delphian/tronrelic-types` — they read
 * `req.authSession` and act as type guards.
 *
 * @example
 * ```typescript
 * import { isLoggedIn, hasPrimaryWallet } from '@delphian/tronrelic-types';
 *
 * // In a plugin route handler
 * handler: async (req, res) => {
 *     if (!isLoggedIn(req)) {
 *         return res.status(401).json({ error: 'Authentication required' });
 *     }
 *
 *     // Wallet-gated routes confirm a signature-proven primary wallet
 *     if (!hasPrimaryWallet(req)) {
 *         return res.status(403).json({ error: 'A linked wallet is required' });
 *     }
 *
 *     // Proceed with the authenticated account
 *     const userId = req.authSession.user.id;
 * }
 * ```
 */
export interface IHttpRequest<
    TParams = Record<string, string>,
    TBody = any,
    TQuery = Record<string, string | string[] | undefined>
> {
    /**
     * URL path parameters extracted from route patterns.
     *
     * For a route `/users/:userId/posts/:postId` and URL `/users/123/posts/456`,
     * params would be `{ userId: '123', postId: '456' }`.
     *
     * @example
     * ```typescript
     * // Route: /subscriptions/:userId
     * // URL: /subscriptions/user123
     * const { userId } = req.params; // 'user123'
     * ```
     */
    params: TParams;

    /**
     * Parsed request body (requires JSON middleware).
     *
     * Contains the parsed JSON body from POST/PUT/PATCH requests. Undefined
     * for GET/DELETE or if no body was sent.
     *
     * @example
     * ```typescript
     * // POST /subscriptions with body: {"userId": "123", "threshold": 1000000}
     * const { userId, threshold } = req.body;
     * ```
     */
    body: TBody;

    /**
     * URL query string parameters.
     *
     * For URL `/items?limit=10&status=active&tag=foo&tag=bar`, query would be:
     * `{ limit: '10', status: 'active', tag: ['foo', 'bar'] }`
     *
     * @example
     * ```typescript
     * // URL: /items?limit=20&skip=0
     * const limit = Number(req.query.limit) || 10;
     * const skip = Number(req.query.skip) || 0;
     * ```
     */
    query: TQuery;

    /**
     * HTTP request headers.
     *
     * All header names are lowercase. Values can be strings or arrays for
     * multi-value headers.
     *
     * @example
     * ```typescript
     * const contentType = req.headers['content-type'];
     * const authToken = req.headers['authorization'];
     * ```
     */
    headers: Record<string, string | string[] | undefined>;

    /**
     * HTTP method (GET, POST, PUT, PATCH, DELETE, etc.).
     *
     * @example
     * ```typescript
     * if (req.method === 'POST') {
     *     // Handle creation
     * }
     * ```
     */
    method: string;

    /**
     * Request URL path (without query string).
     *
     * @example
     * ```typescript
     * // Full URL: /api/plugins/whale-alerts/config?enabled=true
     * console.log(req.path); // '/api/plugins/whale-alerts/config'
     * ```
     */
    path: string;

    /**
     * Client IP address.
     *
     * Respects X-Forwarded-For header when behind a proxy. Useful for
     * rate limiting, logging, and security.
     *
     * @example
     * ```typescript
     * const clientIp = req.ip;
     * logger.info({ ip: clientIp }, 'Request received');
     * ```
     */
    ip?: string;

    /**
     * Full URL including query string.
     *
     * @example
     * ```typescript
     * console.log(req.url); // '/api/plugins/whale-alerts/config?enabled=true'
     * ```
     */
    url?: string;

    /**
     * Get a specific header value by name.
     *
     * Header names are case-insensitive. Returns undefined if header doesn't exist.
     *
     * @param name - Header name (case-insensitive)
     * @returns Header value or undefined
     *
     * @example
     * ```typescript
     * const contentType = req.get('Content-Type');
     * const authorization = req.get('Authorization');
     * ```
     */
    get(name: string): string | undefined;

    /**
     * Better Auth user id of the admin operator, set by the `requireAdmin`
     * middleware on the session-authenticated path for the audit trail.
     *
     * Undefined on anonymous requests, on the service-token admin path, and
     * on any route `requireAdmin` does not guard. Read `req.authSession` for
     * general identity — not this field.
     *
     * @example
     * ```typescript
     * // After requireAdmin admits via the session path, attribute the action:
     * logger.info({ operator: req.userId }, 'admin mutation');
     * ```
     */
    userId?: string;

    /**
     * Resolved Better Auth session, attached by the core
     * `attachAuthSession` middleware before requests reach plugin routes.
     *
     * `null` for anonymous visitors, an {@link IAuthSession} for
     * logged-in ones. It is `undefined` only outside the middleware's
     * reach — test stubs, or the middleware's own bypassed paths (it
     * early-returns on `/api/auth/*`). Plugin routes always run after the
     * middleware, so for plugin handlers `authSession` is always set
     * (`null` or populated), never `undefined`. Gate authenticated plugin
     * routes on `req.authSession` via the `isLoggedIn` / `isAdmin` /
     * `isInGroup` predicates.
     *
     * @example
     * ```typescript
     * import { isLoggedIn, isAdmin } from '@delphian/tronrelic-types';
     *
     * handler: async (req, res) => {
     *     if (!isLoggedIn(req)) {
     *         return res.status(401).json({ error: 'Authentication required' });
     *     }
     *     if (!isAdmin(req)) {
     *         return res.status(403).json({ error: 'Admin required' });
     *     }
     *     const userId = req.authSession.user.id;
     * }
     * ```
     */
    authSession?: IAuthSession | null;
}
