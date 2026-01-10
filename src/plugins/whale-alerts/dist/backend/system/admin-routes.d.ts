import type { IPluginContext, IApiRouteConfig } from '@/types';
/**
 * Create admin API route handlers for whale-alerts plugin.
 *
 * These handlers provide administrative endpoints for configuring the whale-alerts
 * plugin. They are automatically mounted under /api/plugins/whale-alerts/system/
 * and require admin authentication.
 *
 * @param context - Plugin context with database access
 * @returns Array of admin route configurations
 */
export declare function createAdminRoutes(context: IPluginContext): IApiRouteConfig[];
//# sourceMappingURL=admin-routes.d.ts.map