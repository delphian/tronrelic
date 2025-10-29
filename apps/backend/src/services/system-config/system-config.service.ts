import { SystemConfigModel } from '../../database/models/system-config-model.js';
import type { ISystemConfig, ISystemConfigService, ISystemLogService, IDatabaseService } from '@tronrelic/types';
import type { SystemConfigDoc } from '../../database/models/system-config-model.js';

/**
 * SystemConfigService
 *
 * Manages system-wide configuration stored in MongoDB.
 * Provides cached access to settings that need to be editable at runtime
 * without requiring environment variable changes or service restarts.
 *
 * Why this service exists:
 * Environment variables work well for deployment-time configuration, but some
 * settings need to be user-editable through the admin interface. The site URL
 * is a prime example—it's used for webhook construction, email links, and
 * canonical URLs, but may change when migrating domains or adding CDNs.
 *
 * **Architecture:**
 * - Single document pattern: all system config in one document with key="system"
 * - In-memory cache: reduces database queries for frequently-accessed values
 * - Cache invalidation: updates clear cache to ensure fresh reads
 * - Fallback defaults: returns sensible defaults when database is empty
 * - Mongoose model registration: Preserves schema validation and defaults
 *
 * **Usage:**
 * ```typescript
 * const siteUrl = await systemConfigService.getSiteUrl();
 * await systemConfigService.updateConfig({ siteUrl: 'https://tronrelic.com' });
 * ```
 */
export class SystemConfigService implements ISystemConfigService {
    private static instance: SystemConfigService;
    private cache: ISystemConfig | null = null;
    private cacheTime: number = 0;
    private readonly CACHE_TTL_MS = 60000; // 1 minute cache

    private constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {
        // Register Mongoose model for schema validation and defaults
        this.database.registerModel('system_config', SystemConfigModel);
    }

    /**
     * Get singleton instance of the system config service.
     *
     * Why singleton:
     * System configuration is application-wide state that should be consistent
     * across all services and plugins. A singleton ensures cache consistency
     * and prevents redundant database queries from multiple service instances.
     *
     * @returns Shared system config service instance
     */
    public static getInstance(): SystemConfigService {
        if (!SystemConfigService.instance) {
            throw new Error('SystemConfigService not initialized. Call initialize() first in bootstrap.');
        }
        return SystemConfigService.instance;
    }

    /**
     * Initialize the singleton instance with dependencies.
     * Must be called once during application bootstrap before any getInstance() calls.
     *
     * Why separate initialization:
     * Allows dependency injection of logger and database at application startup
     * while maintaining singleton pattern throughout the application lifecycle.
     *
     * @param logger - SystemLogService instance for structured logging
     * @param database - IDatabaseService instance for data access
     */
    public static initialize(logger: ISystemLogService, database: IDatabaseService): void {
        if (SystemConfigService.instance) {
            throw new Error('SystemConfigService already initialized');
        }
        SystemConfigService.instance = new SystemConfigService(logger, database);
    }

    /**
     * Retrieves the current system configuration.
     * Uses in-memory cache to minimize database queries.
     *
     * Why caching:
     * Configuration values are read frequently (every webhook construction, every email)
     * but change rarely. A 1-minute cache reduces database load without sacrificing
     * freshness for admin updates.
     *
     * @returns System configuration object with all settings
     */
    async getConfig(): Promise<ISystemConfig> {
        const now = Date.now();

        // Return cached value if still fresh
        if (this.cache && (now - this.cacheTime) < this.CACHE_TTL_MS) {
            return this.cache;
        }

        try {
            // Fetch from database (automatically uses registered Mongoose model)
            let config = await this.database.findOne<SystemConfigDoc>('system_config', { key: 'system' });

            // Initialize with defaults if not found
            if (!config) {
                this.logger.info('System config not found, creating with defaults');
                const defaultConfig = {
                    key: 'system',
                    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
                    systemLogsMaxCount: 1000000,
                    systemLogsRetentionDays: 30,
                    logLevel: 'info' as const,
                    updatedAt: new Date()
                };

                // Use Mongoose model directly for create (applies defaults and validation)
                const model = this.database.getModel<SystemConfigDoc>('system_config');
                const created = await model!.create(defaultConfig);
                config = created.toObject();
            }

            // Update cache
            this.cache = config as ISystemConfig;
            this.cacheTime = now;

            return this.cache;
        } catch (error) {
            this.logger.error({ error }, 'Failed to fetch system config');

            // Return fallback if database fails
            return {
                key: 'system',
                siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
                systemLogsMaxCount: 1000000,
                systemLogsRetentionDays: 30,
                logLevel: 'info' as const,
                updatedAt: new Date()
            };
        }
    }

    /**
     * Gets the site URL from configuration.
     * Convenience method for the most commonly accessed setting.
     *
     * Why separate method:
     * Most services only need the site URL, not the entire config object.
     * This method provides a cleaner API and allows future optimization
     * (e.g., caching just the URL string).
     *
     * @returns Public site URL (e.g., "https://tronrelic.com")
     */
    async getSiteUrl(): Promise<string> {
        const config = await this.getConfig();
        return config.siteUrl;
    }

    /**
     * Gets the API URL derived from the site URL.
     *
     * Why this exists:
     * The API URL is deterministically derived from the site URL by appending /api.
     * This ensures consistency between what the backend advertises and what clients expect.
     * Instead of storing a separate API URL in the database, we compute it on demand
     * to prevent configuration drift between siteUrl and apiUrl.
     *
     * Usage by frontend:
     * - SSR fetches this once at container startup via /api/config/public
     * - Client receives it injected in HTML via window.__RUNTIME_CONFIG__
     * - Both SSR and client use the same value for API calls
     *
     * @returns API base URL (e.g., "https://tronrelic.com/api")
     */
    async getApiUrl(): Promise<string> {
        const siteUrl = await this.getSiteUrl();
        return `${siteUrl}/api`;
    }

    /**
     * Gets the WebSocket URL derived from the site URL.
     *
     * Why this exists:
     * The WebSocket URL is the same as the site URL (no /api suffix) because Socket.IO
     * connects to the root origin. Like getApiUrl(), we derive this from siteUrl to ensure
     * consistency and prevent configuration drift.
     *
     * Usage by frontend:
     * - Client reads from window.__RUNTIME_CONFIG__.socketUrl (injected by SSR)
     * - Socket.IO client connects to this URL for real-time updates
     * - Replaces hardcoded NEXT_PUBLIC_SOCKET_URL that was frozen at build time
     *
     * @returns WebSocket connection URL (e.g., "https://tronrelic.com")
     */
    async getSocketUrl(): Promise<string> {
        return await this.getSiteUrl();
    }

    /**
     * Updates system configuration with new values.
     * Invalidates cache to ensure subsequent reads get fresh data.
     *
     * Why upsert pattern:
     * On first deployment, the config document won't exist. Upsert
     * creates it if missing, updates if present. This avoids conditional
     * logic in callers and ensures idempotent behavior.
     *
     * @param updates - Partial configuration object with fields to update
     * @param updatedBy - Optional admin identifier for audit trail
     * @returns Updated configuration object
     */
    async updateConfig(
        updates: Partial<Pick<ISystemConfig, 'siteUrl' | 'systemLogsMaxCount' | 'systemLogsRetentionDays' | 'logLevel'>>,
        updatedBy?: string
    ): Promise<ISystemConfig> {
        try {
            // Use Mongoose model directly for findOneAndUpdate (applies validation)
            const model = this.database.getModel<SystemConfigDoc>('system_config');
            if (!model) {
                throw new Error('SystemConfig model not registered');
            }

            const config = await model.findOneAndUpdate(
                { key: 'system' },
                {
                    $set: {
                        ...updates,
                        updatedAt: new Date(),
                        ...(updatedBy && { updatedBy })
                    }
                },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true
                }
            );

            if (!config) {
                throw new Error('Failed to update system config');
            }

            // Invalidate cache
            this.cache = null;
            this.cacheTime = 0;

            this.logger.info({ updates, updatedBy }, 'System config updated');

            return config.toObject() as ISystemConfig;
        } catch (error) {
            this.logger.error({ error, updates }, 'Failed to update system config');
            throw error;
        }
    }

    /**
     * Clears the in-memory cache.
     * Useful for testing or when external processes modify the database directly.
     *
     * Why manual clear:
     * While the cache has a TTL, some scenarios require immediate invalidation.
     * For example, integration tests may want to reset state between test cases,
     * or admin operations may want to force a fresh read after bulk updates.
     */
    clearCache(): void {
        this.cache = null;
        this.cacheTime = 0;
        this.logger.debug('System config cache cleared');
    }
}
