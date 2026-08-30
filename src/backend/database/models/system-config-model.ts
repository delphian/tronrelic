import mongoose, { Schema, Document } from 'mongoose';
import type { ISystemConfig } from '@/types';
import { EMIT_BUFFER_DEFAULTS } from '../../config/emit-buffer.js';

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
 * - `siteWs` - WebSocket URL for Socket.IO connections (e.g., "https://tronrelic.com")
 * - `systemLogsMaxCount` - Maximum number of log entries to retain (default: 1000000)
 * - `systemLogsRetentionDays` - Number of days to keep logs before deletion (default: 30)
 * - `logLevel` - Minimum log level for file/console output (default: 'info')
 * - `emitBuffer*` - The five settings shaping the block feed's playout buffer,
 *   applied to the running `BlockEmitter` the moment they are saved
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
        siteWs: {
            type: String,
            required: true,
            default: 'http://localhost:4000'
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
        logLevel: {
            type: String,
            required: true,
            default: 'info',
            enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
        },
        // The five emit-buffer settings below shape the block feed's playout
        // buffer and were environment variables until they moved here. Each
        // carries a schema default, which covers the two paths that hydrate a
        // document: an insert through `setDefaultsOnInsert`, and the object
        // `findOneAndUpdate` returns.
        //
        // It does not cover reading an existing document, which is the path
        // that matters on an upgraded deployment. `IDatabaseService.findOne`
        // reads registered models through `.lean()`, and a lean read returns
        // the stored document as-is with no hydration and therefore no
        // defaults. A config document written before these fields existed
        // reads back without them, so `SystemConfigService.getConfig()`
        // merges `EMIT_BUFFER_DEFAULTS` in itself. Do not remove that merge on
        // the strength of the defaults below.
        emitBufferTargetDepth: {
            type: Number,
            required: true,
            default: EMIT_BUFFER_DEFAULTS.emitBufferTargetDepth
        },
        emitBufferCatchupDepth: {
            type: Number,
            required: true,
            default: EMIT_BUFFER_DEFAULTS.emitBufferCatchupDepth
        },
        emitBufferMaxDepth: {
            type: Number,
            required: true,
            default: EMIT_BUFFER_DEFAULTS.emitBufferMaxDepth
        },
        emitBufferRefillIntervalMs: {
            type: Number,
            required: true,
            default: EMIT_BUFFER_DEFAULTS.emitBufferRefillIntervalMs
        },
        emitBufferCatchupIntervalMs: {
            type: Number,
            required: true,
            default: EMIT_BUFFER_DEFAULTS.emitBufferCatchupIntervalMs
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
