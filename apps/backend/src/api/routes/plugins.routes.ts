import { Router } from 'express';
import { PluginMetadataService } from '../../services/plugin-metadata.service.js';
import { PluginManagerService } from '../../services/plugin-manager.service.js';
import { logger } from '../../lib/logger.js';

const router = Router();

/**
 * GET /api/plugins/manifests
 *
 * List plugin manifests for the frontend.
 *
 * Returns only installed AND enabled plugins. This ensures the frontend
 * only loads plugins that are active and ready for use. Disabled or
 * uninstalled plugins are hidden from the frontend.
 */
router.get('/manifests', async (req, res) => {
    try {
        const metadataService = PluginMetadataService.getInstance();
        const pluginManager = PluginManagerService.getInstance();

        // Get only installed + enabled plugins
        const activePlugins = await metadataService.getActivePlugins();

        // Get manifests for active plugins only
        const manifests = activePlugins
            .map(metadata => {
                const loaded = pluginManager.getPlugin(metadata.id);
                return loaded ? loaded.manifest : null;
            })
            .filter(manifest => manifest !== null);

        res.json({ manifests });
    } catch (error) {
        logger.error({ error }, 'Failed to load plugin manifests');
        res.status(500).json({ error: 'Failed to load plugin manifests' });
    }
});

export default router;
