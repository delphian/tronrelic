import { SystemConfigModel } from '../../database/models/system-config-model.js';
import type { ISystemConfig, ISystemConfigService } from '@tronrelic/types';
import type { Logger } from 'pino';

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
        private readonly logger: Logger
    ) {}

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
     * Allows dependency injection of the logger at application startup
     * while maintaining singleton pattern throughout the application lifecycle.
     *
     * @param logger - Pino logger instance for structured logging
     */
    public static initialize(logger: Logger): void {
        if (SystemConfigService.instance) {
            throw new Error('SystemConfigService already initialized');
        }
        SystemConfigService.instance = new SystemConfigService(logger);
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
            // Fetch from database
            let config = await SystemConfigModel.findOne({ key: 'system' });

            // Initialize with defaults if not found
            if (!config) {
                this.logger.info('System config not found, creating with defaults');
                config = await SystemConfigModel.create({
                    key: 'system',
                    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
                    systemLogsMaxCount: 1000000,
                    systemLogsRetentionDays: 30,
                    updatedAt: new Date()
                });
            }

            // Update cache
            this.cache = config.toObject();
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
        updates: Partial<Pick<ISystemConfig, 'siteUrl' | 'systemLogsMaxCount' | 'systemLogsRetentionDays'>>,
        updatedBy?: string
    ): Promise<ISystemConfig> {
        try {
            const config = await SystemConfigModel.findOneAndUpdate(
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

            return config.toObject();
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
