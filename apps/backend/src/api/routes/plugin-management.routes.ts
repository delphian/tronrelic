import { Router, type Request, type Response } from 'express';
import type { IPluginInfo } from '@tronrelic/types';
import { PluginMetadataService } from '../../services/plugin-metadata.service.js';
import { PluginManagerService } from '../../services/plugin-manager.service.js';
import { logger } from '../../lib/logger.js';

const router = Router();

/**
 * GET /api/plugin-management/all
 *
 * Get all discovered plugins with their metadata status.
 * Returns both installed/enabled and disabled plugins for admin UI.
 *
 * Requires admin authentication (to be implemented).
 */
router.get('/all', async (req: Request, res: Response) => {
    try {
        const metadataService = PluginMetadataService.getInstance();
        const pluginManager = PluginManagerService.getInstance();

        // Get all plugin manifests
        const manifests = pluginManager.getAllManifests();

        // Get all plugin metadata
        const metadataList = await metadataService.getAllMetadata();

        // Combine manifest + metadata for each plugin
        const pluginInfoList: IPluginInfo[] = manifests.map(manifest => {
            const metadata = metadataList.find(m => m.id === manifest.id);

            if (!metadata) {
                // This should not happen since we register all discovered plugins
                logger.warn({ pluginId: manifest.id }, 'Plugin manifest found but no metadata in database');
                return {
                    manifest: {
                        id: manifest.id,
                        title: manifest.title,
                        version: manifest.version,
                        description: manifest.description,
                        author: manifest.author,
                        license: manifest.license,
                        backend: manifest.backend,
                        frontend: manifest.frontend,
                        adminUrl: manifest.adminUrl
                    },
                    metadata: {
                        id: manifest.id,
                        title: manifest.title,
                        version: manifest.version,
                        installed: false,
                        enabled: false,
                        discoveredAt: new Date(),
                        installedAt: null,
                        enabledAt: null,
                        disabledAt: null,
                        uninstalledAt: null,
                        lastError: null,
                        lastErrorAt: null
                    }
                };
            }

            return {
                manifest: {
                    id: manifest.id,
                    title: manifest.title,
                    version: manifest.version,
                    description: manifest.description,
                    author: manifest.author,
                    license: manifest.license,
                    backend: manifest.backend,
                    frontend: manifest.frontend,
                    adminUrl: manifest.adminUrl
                },
                metadata
            };
        });

        res.json({ plugins: pluginInfoList });
    } catch (error) {
        logger.error({ error }, 'Failed to get all plugins');
        res.status(500).json({ error: 'Failed to get plugins' });
    }
});

/**
 * POST /api/plugin-management/:pluginId/install
 *
 * Install a plugin by running its install() hook.
 * Sets installed: true in database if successful.
 */
router.post('/:pluginId/install', async (req: Request, res: Response) => {
    try {
        const { pluginId } = req.params;
        const pluginManager = PluginManagerService.getInstance();

        const result = await pluginManager.installPlugin(pluginId);

        if (result.success) {
            const metadataService = PluginMetadataService.getInstance();
            const metadata = await metadataService.getMetadata(pluginId);
            res.json({ success: true, message: result.message, metadata });
        } else {
            res.status(400).json({ success: false, error: result.message });
        }
    } catch (error) {
        logger.error({ error, pluginId: req.params.pluginId }, 'Failed to install plugin');
        res.status(500).json({ success: false, error: 'Failed to install plugin' });
    }
});

/**
 * POST /api/plugin-management/:pluginId/uninstall
 *
 * Uninstall a plugin by running its uninstall() hook.
 * Always sets installed: false in database, even if hook fails.
 * Automatically disables the plugin if it's enabled.
 */
router.post('/:pluginId/uninstall', async (req: Request, res: Response) => {
    try {
        const { pluginId } = req.params;
        const pluginManager = PluginManagerService.getInstance();

        const result = await pluginManager.uninstallPlugin(pluginId);

        const metadataService = PluginMetadataService.getInstance();
        const metadata = await metadataService.getMetadata(pluginId);

        if (result.success) {
            res.json({ success: true, message: result.message, metadata });
        } else {
            res.status(400).json({ success: false, error: result.message, metadata });
        }
    } catch (error) {
        logger.error({ error, pluginId: req.params.pluginId }, 'Failed to uninstall plugin');
        res.status(500).json({ success: false, error: 'Failed to uninstall plugin' });
    }
});

/**
 * POST /api/plugin-management/:pluginId/enable
 *
 * Enable a plugin by running its enable() and init() hooks.
 * Sets enabled: true in database if successful.
 * Requires plugin to be installed first.
 */
router.post('/:pluginId/enable', async (req: Request, res: Response) => {
    try {
        const { pluginId } = req.params;
        const pluginManager = PluginManagerService.getInstance();

        const result = await pluginManager.enablePlugin(pluginId);

        if (result.success) {
            const metadataService = PluginMetadataService.getInstance();
            const metadata = await metadataService.getMetadata(pluginId);
            res.json({ success: true, message: result.message, metadata });
        } else {
            res.status(400).json({ success: false, error: result.message });
        }
    } catch (error) {
        logger.error({ error, pluginId: req.params.pluginId }, 'Failed to enable plugin');
        res.status(500).json({ success: false, error: 'Failed to enable plugin' });
    }
});

/**
 * POST /api/plugin-management/:pluginId/disable
 *
 * Disable a plugin by running its disable() hook.
 * Sets enabled: false in database if successful.
 * Plugin remains installed but inactive.
 */
router.post('/:pluginId/disable', async (req: Request, res: Response) => {
    try {
        const { pluginId } = req.params;
        const pluginManager = PluginManagerService.getInstance();

        const result = await pluginManager.disablePlugin(pluginId);

        if (result.success) {
            const metadataService = PluginMetadataService.getInstance();
            const metadata = await metadataService.getMetadata(pluginId);
            res.json({ success: true, message: result.message, metadata });
        } else {
            res.status(400).json({ success: false, error: result.message });
        }
    } catch (error) {
        logger.error({ error, pluginId: req.params.pluginId }, 'Failed to disable plugin');
        res.status(500).json({ success: false, error: 'Failed to disable plugin' });
    }
});

export default router;
