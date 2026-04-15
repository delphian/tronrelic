import type { IHttpRequest } from '../http/IHttpRequest.js';
import type { IHttpResponse } from '../http/IHttpResponse.js';
import type { IHttpNext } from '../http/IHttpNext.js';

/**
 * HTTP method types supported by plugin API routes.
 *
 * These represent the standard REST HTTP verbs that plugins can use to expose
 * their API endpoints.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * API route handler function signature.
 *
 * Plugins implement this to handle requests to their registered API endpoints.
 * The handler receives framework-agnostic HTTP request/response objects and
 * follows standard middleware patterns for error handling and async operations.
 *
 * This abstraction allows plugins to remain independent of the underlying HTTP
 * framework (Express, Fastify, Koa, etc.).
 *
 * @param req - HTTP request object with params, body, query, headers
 * @param res - HTTP response object for sending JSON or status codes
 * @param next - Next function for error handling and middleware chaining
 *
 * @example
 * ```typescript
 * const handler: ApiRouteHandler = async (req, res, next) => {
 *     try {
 *         const userId = req.params.userId;
 *         const data = await database.findOne('subscriptions', { userId });
 *         res.json(data);
 *     } catch (error) {
 *         next(error);
 *     }
 * };
 * ```
 */
export type ApiRouteHandler = (
    req: IHttpRequest,
    res: IHttpResponse,
    next: IHttpNext
) => void | Promise<void>;

/**
 * Middleware function signature for request processing.
 *
 * Middleware functions can modify the request/response, perform validation,
 * authentication, logging, or other pre/post-processing tasks. They must
 * call next() to pass control to the next middleware or handler.
 *
 * @param req - HTTP request object
 * @param res - HTTP response object
 * @param next - Next function to continue middleware chain
 *
 * @example
 * ```typescript
 * const loggerMiddleware: ApiMiddleware = async (req, res, next) => {
 *     console.log(`${req.method} ${req.path}`);
 *     next();
 * };
 * ```
 */
export type ApiMiddleware = (
    req: IHttpRequest,
    res: IHttpResponse,
    next: IHttpNext
) => void | Promise<void>;

/**
 * Configuration for a single API route registered by a plugin.
 *
 * Defines an HTTP endpoint that the plugin exposes, including the method, path,
 * handler function, and optional access controls. Routes are automatically
 * mounted under /api/plugins/{plugin-id}/ to prevent conflicts between plugins.
 *
 * @example
 * ```typescript
 * const route: IApiRouteConfig = {
 *     method: 'GET',
 *     path: '/subscriptions/:userId',
 *     handler: async (req, res, next) => {
 *         try {
 *             const data = await database.findOne('subscriptions', {
 *                 userId: req.params.userId
 *             });
 *             res.json(data);
 *         } catch (error) {
 *             next(error);
 *         }
 *     },
 *     requiresAuth: true
 * };
 * // Accessible at: GET /api/plugins/my-plugin/subscriptions/user123
 * ```
 */
export interface IApiRouteConfig {
    /**
     * HTTP method for this route (GET, POST, PUT, PATCH, DELETE).
     *
     * Choose the appropriate method based on the operation:
     * - GET: Retrieve data (idempotent, no side effects)
     * - POST: Create resources or non-idempotent operations
     * - PUT: Replace entire resources
     * - PATCH: Update partial resources
     * - DELETE: Remove resources
     */
    method: HttpMethod;

    /**
     * URL path relative to the plugin's API namespace.
     *
     * The path is mounted under /api/plugins/{plugin-id}/ automatically.
     * Supports colon-delimited path parameters like :userId or :id.
     *
     * @example
     * ```typescript
     * // Static path
     * path: '/config'  // → /api/plugins/my-plugin/config
     *
     * // With parameters
     * path: '/subscriptions/:userId'  // → /api/plugins/my-plugin/subscriptions/123
     *
     * // Nested paths
     * path: '/alerts/:alertId/dismiss'  // → /api/plugins/my-plugin/alerts/456/dismiss
     * ```
     */
    path: string;

    /**
     * Request handler function that processes this route.
     *
     * Receives framework-agnostic request/response objects. Use async/await
     * for database operations and call next(error) to trigger error handling
     * middleware.
     */
    handler: ApiRouteHandler;

    /**
     * Requires user authentication to access this route.
     *
     * When true, the route checks for a valid authentication token before
     * calling the handler. Unauthenticated requests receive a 401 error.
     *
     * Default: false (public access)
     */
    requiresAuth?: boolean;

    /**
     * Requires admin privileges to access this route.
     *
     * When true, the route checks both authentication and admin role before
     * calling the handler. Non-admin requests receive a 403 error.
     *
     * Default: false (no admin requirement)
     */
    requiresAdmin?: boolean;

    /**
     * Additional middleware to run before the handler.
     *
     * Use this for custom validation, rate limiting, or request transformation.
     * Middleware runs in array order before the main handler.
     *
     * @example
     * ```typescript
     * middleware: [
     *     validateRequestBody,
     *     rateLimiter({ max: 100, window: '15m' }),
     *     parseCustomHeaders
     * ]
     * ```
     */
    middleware?: ApiMiddleware[];

    /**
     * Human-readable description of what this route does.
     *
     * Used for API documentation generation and developer reference. Explain
     * the purpose, expected inputs, and what data is returned.
     *
     * @example
     * ```typescript
     * description: 'Get all active whale alert subscriptions for a specific user'
     * ```
     */
    description?: string;
}
