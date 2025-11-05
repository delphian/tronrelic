import type { IPluginContext, IApiRouteConfig } from '@tronrelic/types';
import { DEFAULT_CONFIG, type IResourceMarketsConfig } from '../../shared/types/config.js';

/**
 * Creates configuration API routes for resource-markets plugin.
 *
 * Provides endpoints for retrieving and updating plugin configuration including
 * public page URL, menu label, icon, and display order.
 *
 * **Admin Endpoints:**
 * - `GET /plugins/resource-markets/system/config` - Get current configuration
 * - `PUT /plugins/resource-markets/system/config` - Update configuration
 *
 * @param context - Plugin context with database, logger, and menu service access
 * @returns Array of API route configurations
 */
export function createConfigRoutes(context: IPluginContext): IApiRouteConfig[] {
    const { database, logger, menuService } = context;

    return [
        {
            method: 'GET',
            path: '/config',
            handler: async (req, res, next) => {
                try {
                    // Get config from database (stored in key-value store)
                    const config = await database.get<IResourceMarketsConfig>('config');

                    // Return config or default if not found
                    res.json({
                        success: true,
                        config: config || DEFAULT_CONFIG
                    });
                } catch (error) {
                    logger.error({ error }, 'Failed to retrieve resource-markets config');
                    next(error);
                }
            }
        },
        {
            method: 'PUT',
            path: '/config',
            handler: async (req, res, next) => {
                try {
                    const newConfig = req.body as IResourceMarketsConfig;

                    // Validate config
                    if (!newConfig.publicPageUrl || !newConfig.publicPageUrl.startsWith('/plugins/resource-markets/')) {
                        res.status(400).json({
                            success: false,
                            error: 'publicPageUrl must start with /plugins/resource-markets/'
                        });
                        return;
                    }

                    if (!newConfig.menuLabel || newConfig.menuLabel.trim().length === 0) {
                        res.status(400).json({
                            success: false,
                            error: 'menuLabel cannot be empty'
                        });
                        return;
                    }

                    if (!newConfig.menuIcon || newConfig.menuIcon.trim().length === 0) {
                        res.status(400).json({
                            success: false,
                            error: 'menuIcon cannot be empty'
                        });
                        return;
                    }

                    if (typeof newConfig.menuOrder !== 'number' || newConfig.menuOrder < 0) {
                        res.status(400).json({
                            success: false,
                            error: 'menuOrder must be a positive number'
                        });
                        return;
                    }

                    // Save config to database
                    await database.set('config', newConfig);

                    logger.info({ config: newConfig }, 'Resource-markets config updated');

                    // Update menu item with new configuration
                    try {
                        // Get current config to retrieve stored menu item ID
                        const currentConfig = await database.get<IResourceMarketsConfig>('config');
                        const menuItemId = currentConfig?.menuItemId || newConfig.menuItemId;

                        if (menuItemId) {
                            await menuService.update(menuItemId, {
                                label: newConfig.menuLabel,
                                url: newConfig.publicPageUrl,
                                icon: newConfig.menuIcon,
                                order: newConfig.menuOrder
                            });
                            logger.info({ menuItemId }, 'Updated menu item with new config');

                            // Preserve menu item ID in new config
                            newConfig.menuItemId = menuItemId;
                        } else {
                            logger.warn('No menu item ID found, skipping menu update');
                        }
                    } catch (menuError) {
                        logger.error({ error: menuError }, 'Failed to update menu item');
                        // Don't fail the whole request if menu update fails
                    }

                    res.json({
                        success: true,
                        config: newConfig
                    });
                } catch (error) {
                    logger.error({ error }, 'Failed to save resource-markets config');
                    next(error);
                }
            }
        }
    ];
}
