import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import type { IPlugin, IApiRouteConfig, IHttpRequest, IHttpResponse, IHttpNext, ApiRouteHandler, ApiMiddleware } from '@tronrelic/types';
import { logger } from '../lib/logger.js';
import { requireAdmin } from '../api/middleware/admin-auth.js';

/**
 * Adapt Express Request to framework-agnostic IHttpRequest.
 *
 * This adapter wraps Express's Request object to match our IHttpRequest interface,
 * allowing plugins to remain independent of Express-specific types. The adaptation
 * is structural - Express Request already has all the properties we need.
 *
 * @param req - Express Request object
 * @returns IHttpRequest-compatible object
 */
function adaptRequest(req: Request): IHttpRequest {
    return req as unknown as IHttpRequest;
}

/**
 * Adapt Express Response to framework-agnostic IHttpResponse.
 *
 * This adapter wraps Express's Response object to match our IHttpResponse interface.
 * Express Response is structurally compatible with our interface, so this is mainly
 * for type safety and future flexibility.
 *
 * @param res - Express Response object
 * @returns IHttpResponse-compatible object
 */
function adaptResponse(res: Response): IHttpResponse {
    return res as unknown as IHttpResponse;
}

/**
 * Adapt Express NextFunction to framework-agnostic IHttpNext.
 *
 * This adapter wraps Express's NextFunction to match our IHttpNext interface.
 * Both signatures are identical, so this is a simple pass-through for type safety.
 *
 * @param next - Express NextFunction
 * @returns IHttpNext-compatible function
 */
function adaptNext(next: NextFunction): IHttpNext {
    return next as IHttpNext;
}

/**
 * Convert plugin handler to Express RequestHandler.
 *
 * This adapter wraps a plugin's ApiRouteHandler to work with Express's middleware
 * system. It adapts the Express req/res/next to our framework-agnostic interfaces
 * before calling the plugin handler.
 *
 * @param handler - Plugin route handler using abstracted types
 * @returns Express-compatible RequestHandler
 */
function adaptHandler(handler: ApiRouteHandler): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await handler(
                adaptRequest(req),
                adaptResponse(res),
                adaptNext(next)
            );
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Convert plugin middleware to Express RequestHandler.
 *
 * This adapter wraps a plugin's ApiMiddleware to work with Express's middleware
 * system, similar to adaptHandler but for middleware functions.
 *
 * @param middleware - Plugin middleware using abstracted types
 * @returns Express-compatible RequestHandler
 */
function adaptMiddleware(middleware: ApiMiddleware): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await middleware(
                adaptRequest(req),
                adaptResponse(res),
                adaptNext(next)
            );
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Service for managing plugin API route registration.
 *
 * This service creates and manages Express routers for plugins, mounting their
 * API routes under /api/plugins/{plugin-id}/. It handles route registration,
 * middleware chaining, and access control for all plugin endpoints.
 *
 * The service adapts plugin handlers (using framework-agnostic types) to Express
 * RequestHandlers, keeping plugins decoupled from the HTTP framework.
 *
 * Why this exists:
 * Plugins need to expose REST APIs for external integrations, data management,
 * and client operations without modifying core routing files. This service
 * provides isolated API namespaces per plugin and enforces consistent patterns.
 */
export class PluginApiService {
    private static instance: PluginApiService;
    private pluginRouters: Map<string, Router> = new Map();
    private rootRouter: Router;

    private constructor() {
        this.rootRouter = Router();
    }

    /**
     * Get the singleton instance of the plugin API service.
     *
     * Using a singleton ensures all plugins register through the same service
     * instance, preventing duplicate route registration and maintaining a
     * centralized registry of plugin endpoints.
     *
     * @returns The shared plugin API service instance
     */
    public static getInstance(): PluginApiService {
        if (!PluginApiService.instance) {
            PluginApiService.instance = new PluginApiService();
        }
        return PluginApiService.instance;
    }

    /**
     * Register all routes for a plugin.
     *
     * Creates an Express router for the plugin and mounts all its route handlers.
     * Routes are namespaced under the plugin ID to prevent conflicts. Each route
     * gets its own middleware chain including auth checks if specified.
     *
     * Public routes are mounted at /api/plugins/{plugin-id}/*
     * Admin routes are mounted at /api/plugins/{plugin-id}/system/* with auth enforced
     *
     * @param plugin - Plugin definition with routes to register
     *
     * @example
     * ```typescript
     * const plugin = {
     *     manifest: { id: 'whale-alerts', ... },
     *     routes: [
     *         { method: 'GET', path: '/subscriptions', handler: getSubscriptions }
     *     ],
     *     adminRoutes: [
     *         { method: 'PUT', path: '/config', handler: updateConfig }
     *     ]
     * };
     * service.registerPluginRoutes(plugin);
     * // Public routes: GET /api/plugins/whale-alerts/subscriptions
     * // Admin routes: PUT /api/plugins/whale-alerts/system/config
     * ```
     */
    public registerPluginRoutes(plugin: IPlugin): void {
        const hasPublicRoutes = plugin.routes && plugin.routes.length > 0;
        const hasAdminRoutes = plugin.adminRoutes && plugin.adminRoutes.length > 0;

        if (!hasPublicRoutes && !hasAdminRoutes) {
            logger.warn(
                { pluginId: plugin.manifest.id, title: plugin.manifest.title },
                'Plugin has no routes to register (empty routes and adminRoutes arrays)'
            );
            return;
        }

        const pluginId = plugin.manifest.id;
        const router = Router();

        // Register public routes
        if (hasPublicRoutes) {
            logger.info(
                { pluginId, routeCount: plugin.routes!.length },
                `Registering ${plugin.routes!.length} public API route(s) for plugin: ${plugin.manifest.title}`
            );

            for (const route of plugin.routes!) {
                this.registerRoute(router, pluginId, route, false);
            }
        }

        // Register admin routes with auth enforcement
        if (hasAdminRoutes) {
            logger.info(
                { pluginId, routeCount: plugin.adminRoutes!.length },
                `Registering ${plugin.adminRoutes!.length} admin API route(s) for plugin: ${plugin.manifest.title}`
            );

            for (const route of plugin.adminRoutes!) {
                this.registerRoute(router, pluginId, route, true);
            }
        }

        this.pluginRouters.set(pluginId, router);
        this.rebuildRootRouter();
    }

    /**
     * Register a single route on the plugin's router.
     *
     * Configures the Express route with the appropriate HTTP method, path, middleware
     * chain, and handler. Adds auth/admin checks if required by the route config.
     *
     * Admin routes are automatically prefixed with /system/ and require admin auth.
     *
     * The method adapts plugin handlers and middleware (using framework-agnostic types)
     * to Express RequestHandlers, ensuring plugins remain decoupled from Express.
     *
     * @param router - Express router for this plugin
     * @param pluginId - Plugin identifier for logging
     * @param route - Route configuration with method, path, and handler
     * @param isAdmin - Whether this is an admin route (auto-prefixed with /system/)
     */
    private registerRoute(router: Router, pluginId: string, route: IApiRouteConfig, isAdmin: boolean): void {
        const { method, path, handler, middleware = [], requiresAuth, requiresAdmin } = route;

        // Build middleware chain - adapt plugin middleware to Express RequestHandlers
        const middlewareChain: RequestHandler[] = middleware.map(adaptMiddleware);

        // Admin routes always require admin auth
        if (isAdmin || requiresAdmin) {
            middlewareChain.unshift(requireAdmin);
            logger.debug({ pluginId, path }, 'Admin auth middleware applied to route');
        } else if (requiresAuth) {
            // TODO: Implement authentication middleware
            // middlewareChain.unshift(authMiddleware);
        }

        // Adapt plugin handler to Express RequestHandler
        const expressHandler = adaptHandler(handler);

        // Admin routes get /system/ prefix
        const routePath = isAdmin ? `/system${path}` : path;

        // Register the route with Express
        const methodLower = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        router[methodLower](routePath, ...middlewareChain, expressHandler);

        logger.debug(
            {
                pluginId,
                method,
                path: `/api/plugins/${pluginId}${routePath}`,
                requiresAuth,
                requiresAdmin,
                isAdmin
            },
            `Registered route: ${method} ${routePath}`
        );
    }

    /**
     * Get the router for a specific plugin.
     *
     * Retrieves the Express router containing all registered routes for the
     * specified plugin. Returns undefined if the plugin has no routes registered.
     *
     * @param pluginId - Plugin identifier
     * @returns Express router with the plugin's routes, or undefined
     */
    public getPluginRouter(pluginId: string): Router | undefined {
        return this.pluginRouters.get(pluginId);
    }

    /**
     * Get the root router that aggregates all plugin routes.
     *
     * This router is mounted once in the Express app and updated dynamically
     * whenever plugins are enabled or disabled.
     *
     * @returns Express router containing all plugin routes
     */
    public getRouter(): Router {
        return this.rootRouter;
    }

    /**
     * Get all plugin routers for mounting in the main Express app.
     *
     * Returns a map of plugin IDs to their routers. The main API router uses this
     * to mount all plugin routes under /api/plugins/{plugin-id}/.
     *
     * @returns Map of plugin IDs to Express routers
     */
    public getAllPluginRouters(): Map<string, Router> {
        return this.pluginRouters;
    }

    /**
     * Unregister routes for a specific plugin.
     *
     * Removes the plugin's router from the registry. Used during plugin disable
     * operations to prevent disabled plugins from handling requests.
     *
     * @param pluginId - Plugin identifier
     */
    public unregisterPluginRoutes(pluginId: string): void {
        if (this.pluginRouters.has(pluginId)) {
            this.pluginRouters.delete(pluginId);
            logger.info({ pluginId }, `Unregistered API routes for plugin: ${pluginId}`);
            this.rebuildRootRouter();
        }
    }

    /**
     * Clear all registered plugin routes.
     *
     * Removes all plugin routers from the registry. Useful for testing or hot
     * reloading scenarios where plugins need to be re-registered.
     */
    public clear(): void {
        this.pluginRouters.clear();
        logger.debug('Cleared all plugin routes');
        this.rebuildRootRouter();
    }

    /**
     * Get statistics about registered plugin routes.
     *
     * Returns counts and metadata about all registered plugin routes for
     * monitoring and debugging.
     *
     * @returns Object with route statistics
     */
    public getStats(): {
        totalPlugins: number;
        pluginIds: string[];
    } {
        return {
            totalPlugins: this.pluginRouters.size,
            pluginIds: Array.from(this.pluginRouters.keys())
        };
    }

    /**
     * Rebuild the root router with the current plugin routers.
     *
     * Clears existing middleware stack and reattaches all registered plugin routers
     * so newly enabled plugins become available immediately without restarting the server.
     */
    private rebuildRootRouter(): void {
        const root = this.rootRouter as unknown as { stack?: unknown[] };
        if (Array.isArray(root.stack)) {
            root.stack.length = 0;
        }

        for (const [pluginId, router] of this.pluginRouters.entries()) {
            this.rootRouter.use(`/${pluginId}`, router);
        }
    }
}
