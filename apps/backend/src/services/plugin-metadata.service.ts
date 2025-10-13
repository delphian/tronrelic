import type { IPluginMetadata, IPluginManifest } from '@tronrelic/types';
import { PluginMetadata } from '../database/models/PluginMetadata.js';
import { logger } from '../lib/logger.js';

/**
 * Service for managing plugin metadata in the database.
 *
 * Handles plugin state tracking including installation status, enabled state,
 * and lifecycle timestamps. Provides methods for auto-discovery registration
 * and state transitions triggered by plugin management operations.
 */
export class PluginMetadataService {
    private static instance: PluginMetadataService;

    /**
     * Get singleton instance of the plugin metadata service.
     *
     * The singleton pattern ensures consistent state management across
     * all plugin operations throughout the application lifecycle.
     *
     * @returns Shared plugin metadata service instance
     */
    public static getInstance(): PluginMetadataService {
        if (!PluginMetadataService.instance) {
            PluginMetadataService.instance = new PluginMetadataService();
        }
        return PluginMetadataService.instance;
    }

    /**
     * Register a discovered plugin in the database if it doesn't exist.
     *
     * Auto-discovered plugins are added with default states of installed: false
     * and enabled: false. If the plugin already exists, its title and version
     * are updated to match the current manifest.
     *
     * @param manifest - Plugin manifest from the discovered plugin
     * @returns Plugin metadata from database (existing or newly created)
     */
    public async registerPlugin(manifest: IPluginManifest): Promise<IPluginMetadata> {
        try {
            const existing = await PluginMetadata.findOne({ id: manifest.id });

            if (existing) {
                // Update title and version if they've changed
                if (existing.title !== manifest.title || existing.version !== manifest.version) {
                    existing.title = manifest.title;
                    existing.version = manifest.version;
                    await existing.save();
                    logger.info(
                        { pluginId: manifest.id, version: manifest.version },
                        'Updated plugin metadata'
                    );
                }
                return this.toPlainObject(existing);
            }

            // Create new metadata entry with default disabled state
            const metadata = await PluginMetadata.create({
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
            });

            logger.info(
                { pluginId: manifest.id, version: manifest.version },
                'Registered new plugin'
            );

            return this.toPlainObject(metadata);
        } catch (error) {
            logger.error({ error, pluginId: manifest.id }, 'Failed to register plugin');
            throw error;
        }
    }

    /**
     * Get metadata for a specific plugin by ID.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Plugin metadata if found, null otherwise
     */
    public async getMetadata(pluginId: string): Promise<IPluginMetadata | null> {
        const metadata = await PluginMetadata.findOne({ id: pluginId });
        return metadata ? this.toPlainObject(metadata) : null;
    }

    /**
     * Get metadata for all registered plugins.
     *
     * @returns Array of all plugin metadata entries
     */
    public async getAllMetadata(): Promise<IPluginMetadata[]> {
        const metadataList = await PluginMetadata.find({});
        return metadataList.map(m => this.toPlainObject(m));
    }

    /**
     * Get metadata for installed and enabled plugins only.
     *
     * Used by the plugin loader to determine which plugins should be initialized
     * and by the frontend manifest endpoint to return available plugins.
     *
     * @returns Array of metadata for plugins that are both installed and enabled
     */
    public async getActivePlugins(): Promise<IPluginMetadata[]> {
        const metadataList = await PluginMetadata.find({ installed: true, enabled: true });
        return metadataList.map(m => this.toPlainObject(m));
    }

    /**
     * Mark a plugin as installed.
     *
     * Called after the plugin's install() hook completes successfully.
     * Sets installed: true and records the installation timestamp.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Updated metadata
     */
    public async markInstalled(pluginId: string): Promise<IPluginMetadata> {
        const metadata = await PluginMetadata.findOneAndUpdate(
            { id: pluginId },
            {
                installed: true,
                installedAt: new Date(),
                lastError: null,
                lastErrorAt: null
            },
            { new: true }
        );

        if (!metadata) {
            throw new Error(`Plugin ${pluginId} not found in database`);
        }

        logger.info({ pluginId }, 'Plugin marked as installed');
        return this.toPlainObject(metadata);
    }

    /**
     * Mark a plugin as uninstalled.
     *
     * Called after the plugin's uninstall() hook completes (or fails - we always
     * set installed: false regardless of hook outcome). Sets installed: false,
     * enabled: false, and records the uninstallation timestamp.
     *
     * @param pluginId - Unique plugin identifier
     * @param error - Optional error message if uninstall hook failed
     * @returns Updated metadata
     */
    public async markUninstalled(pluginId: string, error?: string): Promise<IPluginMetadata> {
        const updateData: any = {
            installed: false,
            enabled: false,
            uninstalledAt: new Date()
        };

        if (error) {
            updateData.lastError = error;
            updateData.lastErrorAt = new Date();
        } else {
            updateData.lastError = null;
            updateData.lastErrorAt = null;
        }

        const metadata = await PluginMetadata.findOneAndUpdate(
            { id: pluginId },
            updateData,
            { new: true }
        );

        if (!metadata) {
            throw new Error(`Plugin ${pluginId} not found in database`);
        }

        logger.info({ pluginId, error: error ?? undefined }, 'Plugin marked as uninstalled');
        return this.toPlainObject(metadata);
    }

    /**
     * Mark a plugin as enabled.
     *
     * Called after the plugin's enable() hook completes successfully.
     * Sets enabled: true and records the enable timestamp.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Updated metadata
     */
    public async markEnabled(pluginId: string): Promise<IPluginMetadata> {
        const metadata = await PluginMetadata.findOneAndUpdate(
            { id: pluginId },
            {
                enabled: true,
                enabledAt: new Date(),
                lastError: null,
                lastErrorAt: null
            },
            { new: true }
        );

        if (!metadata) {
            throw new Error(`Plugin ${pluginId} not found in database`);
        }

        logger.info({ pluginId }, 'Plugin marked as enabled');
        return this.toPlainObject(metadata);
    }

    /**
     * Mark a plugin as disabled.
     *
     * Called after the plugin's disable() hook completes successfully.
     * Sets enabled: false and records the disable timestamp.
     *
     * @param pluginId - Unique plugin identifier
     * @returns Updated metadata
     */
    public async markDisabled(pluginId: string): Promise<IPluginMetadata> {
        const metadata = await PluginMetadata.findOneAndUpdate(
            { id: pluginId },
            {
                enabled: false,
                disabledAt: new Date(),
                lastError: null,
                lastErrorAt: null
            },
            { new: true }
        );

        if (!metadata) {
            throw new Error(`Plugin ${pluginId} not found in database`);
        }

        logger.info({ pluginId }, 'Plugin marked as disabled');
        return this.toPlainObject(metadata);
    }

    /**
     * Record an error for a plugin.
     *
     * Called when a lifecycle hook fails (install, uninstall, enable, disable).
     * Stores the error message and timestamp for debugging and UI display.
     *
     * @param pluginId - Unique plugin identifier
     * @param error - Error message or Error object
     * @returns Updated metadata
     */
    public async recordError(pluginId: string, error: string | Error): Promise<IPluginMetadata> {
        const errorMessage = error instanceof Error ? error.message : error;

        const metadata = await PluginMetadata.findOneAndUpdate(
            { id: pluginId },
            {
                lastError: errorMessage,
                lastErrorAt: new Date()
            },
            { new: true }
        );

        if (!metadata) {
            throw new Error(`Plugin ${pluginId} not found in database`);
        }

        logger.error({ pluginId, error: errorMessage }, 'Plugin error recorded');
        return this.toPlainObject(metadata);
    }

    /**
     * Convert Mongoose document to plain IPluginMetadata object.
     *
     * Strips Mongoose-specific properties and ensures clean serialization
     * for API responses and internal use.
     *
     * @param doc - Mongoose plugin metadata document
     * @returns Plain plugin metadata object
     */
    private toPlainObject(doc: any): IPluginMetadata {
        return {
            id: doc.id,
            title: doc.title,
            version: doc.version,
            installed: doc.installed,
            enabled: doc.enabled,
            discoveredAt: doc.discoveredAt,
            installedAt: doc.installedAt,
            enabledAt: doc.enabledAt,
            disabledAt: doc.disabledAt,
            uninstalledAt: doc.uninstalledAt,
            lastError: doc.lastError,
            lastErrorAt: doc.lastErrorAt
        };
    }
}
