import type { IUser } from '../user/IUser.js';

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
 * ## User Context
 *
 * The `userId` and `user` fields are populated by middleware before requests
 * reach plugin routes. Plugins can check `req.user` to determine if a user
 * is authenticated and access their profile data.
 *
 * @example
 * ```typescript
 * // In a plugin route handler
 * handler: async (req, res) => {
 *     if (!req.user) {
 *         return res.status(401).json({ error: 'Authentication required' });
 *     }
 *
 *     // Check if user has linked wallets (registered)
 *     const isRegistered = (req.user.wallets?.length ?? 0) > 0;
 *     if (!isRegistered) {
 *         return res.status(403).json({ error: 'Wallet verification required' });
 *     }
 *
 *     // Proceed with authenticated, registered user
 *     const userId = req.userId;
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
     * User UUID extracted from the `tronrelic_uid` cookie.
     *
     * Populated by middleware before requests reach plugin routes. Undefined if
     * no valid user cookie is present.
     *
     * @example
     * ```typescript
     * if (!req.userId) {
     *     return res.status(401).json({ error: 'Authentication required' });
     * }
     * ```
     */
    userId?: string;

    /**
     * Resolved user data from userService.
     *
     * Populated by middleware after resolving `userId` via userService. Undefined if
     * no valid user cookie is present or user doesn't exist in database.
     *
     * To check if a user is "registered" (has linked wallets):
     * ```typescript
     * const isRegistered = (req.user?.wallets?.length ?? 0) > 0;
     * ```
     *
     * @example
     * ```typescript
     * if (!req.user) {
     *     return res.status(401).json({ error: 'Authentication required' });
     * }
     *
     * // Access user data
     * const wallets = req.user.wallets;
     * const preferences = req.user.preferences;
     * ```
     */
    user?: IUser;
}
