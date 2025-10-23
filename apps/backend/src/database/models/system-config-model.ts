import mongoose, { Schema, Document } from 'mongoose';

/**
 * SystemConfigDoc
 *
 * MongoDB document for storing system-wide configuration values.
 * Provides a persistent, database-backed alternative to environment variables
 * for settings that need to be editable at runtime through the admin interface.
 *
 * Why this model exists:
 * Environment variables are baked into container images and require redeployment
 * to change. For settings like the public site URL (used for webhook construction,
 * email links, etc.), administrators need the ability to update values without
 * restarting services or rebuilding images.
 *
 * **Schema Fields:**
 * - `key` - Unique configuration key (e.g., "system", "email", "notifications")
 * - `siteUrl` - Public-facing URL of the site (e.g., "https://tronrelic.com")
 * - `systemLogsMaxCount` - Maximum number of log entries to retain (default: 1000000)
 * - `systemLogsRetentionDays` - Number of days to keep logs before deletion (default: 30)
 * - `updatedAt` - Timestamp of last configuration change
 * - `updatedBy` - Admin identifier who made the change (for audit trail)
 *
 * **Usage:**
 * Services that need the site URL query this collection on initialization or
 * on-demand. The SystemConfigService provides a cached accessor to minimize
 * database queries.
 *
 * **Design Decision - Single Document Pattern:**
 * Uses a single document with key="system" to store all system-wide settings.
 * This approach simplifies queries (no filtering needed) and allows atomic updates
 * of multiple related settings. Future settings (apiRateLimit, maintenanceMode, etc.)
 * can be added as new fields without schema migrations.
 *
 * @example
 * ```typescript
 * const config = await SystemConfigModel.findOne({ key: 'system' });
 * const siteUrl = config?.siteUrl || 'http://localhost:3000';
 * ```
 */
export interface ISystemConfig {
    key: string;
    siteUrl: string;
    systemLogsMaxCount: number;
    systemLogsRetentionDays: number;
    updatedAt: Date;
    updatedBy?: string;
}

export type SystemConfigDoc = Document & ISystemConfig;

const systemConfigSchema = new Schema<SystemConfigDoc>(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            index: true,
            default: 'system'
        },
        siteUrl: {
            type: String,
            required: true,
            default: 'http://localhost:3000'
        },
        systemLogsMaxCount: {
            type: Number,
            required: true,
            default: 1000000
        },
        systemLogsRetentionDays: {
            type: Number,
            required: true,
            default: 30
        },
        updatedAt: {
            type: Date,
            default: Date.now
        },
        updatedBy: {
            type: String,
            required: false
        }
    },
    {
        collection: 'system_config',
        timestamps: false
    }
);

export const SystemConfigModel = mongoose.model<SystemConfigDoc>(
    'SystemConfig',
    systemConfigSchema
);
