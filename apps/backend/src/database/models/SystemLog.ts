import { Schema, model, Document } from 'mongoose';

/**
 * Log level type for system logs.
 *
 * Represents the severity of a log entry. TronRelic captures ERROR and WARN
 * levels by default, with optional support for INFO and DEBUG in future iterations.
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * MongoDB document interface for system logs.
 *
 * System logs are captured from Pino logger instances across the application
 * and stored in MongoDB for historical analysis, troubleshooting, and admin visibility.
 * This schema supports filtering by severity, service, time range, and provides
 * metadata for error context.
 */
export interface ISystemLogDocument extends Document {
    /**
     * Timestamp when the log entry was created.
     *
     * Indexed for efficient time-range queries and sorting. Used by cleanup
     * scheduler to enforce retention policies.
     */
    timestamp: Date;

    /**
     * Log severity level (error, warn, info, debug).
     *
     * Indexed for efficient filtering by severity. Admin UI provides checkboxes
     * to filter displayed logs by selected severity types.
     */
    level: LogLevel;

    /**
     * Log message text.
     *
     * Human-readable description of the event. For errors, this is typically
     * the error message. For warnings, this describes the warning condition.
     */
    message: string;

    /**
     * Service or plugin ID that generated the log.
     *
     * Examples: 'tronrelic-backend', 'whale-alerts', 'resource-tracking'.
     * Indexed for efficient filtering by service. Allows correlation of errors
     * with specific plugins or backend services.
     */
    service: string;

    /**
     * Structured metadata associated with the log entry.
     *
     * Contains additional context like error stacks, request details, plugin
     * metadata, observer names, etc. Stored as flexible object to accommodate
     * varying log contexts across different services.
     */
    context: Record<string, any>;

    /**
     * Flag indicating whether the issue has been acknowledged/resolved.
     *
     * Allows admins to mark errors as resolved without deleting them from
     * the database. Useful for tracking historical issues and their resolution.
     */
    resolved: boolean;

    /**
     * Timestamp when the log entry was marked as resolved.
     *
     * Optional field populated when `resolved` is set to true. Allows tracking
     * of time-to-resolution metrics.
     */
    resolvedAt?: Date;

    /**
     * Username or admin token ID of the person who resolved the issue.
     *
     * Optional field for audit trail. In future iterations, could be linked
     * to user accounts or admin session identifiers.
     */
    resolvedBy?: string;
}

/**
 * Mongoose schema for system logs collection.
 *
 * Stores ERROR and WARN log entries from Pino logger instances across the application.
 * Provides indexes for efficient querying by timestamp, level, and service.
 * Supports automatic cleanup via scheduler job based on retention policy.
 */
const systemLogSchema = new Schema<ISystemLogDocument>(
    {
        timestamp: {
            type: Date,
            required: true,
            index: true
        },
        level: {
            type: String,
            required: true,
            enum: ['error', 'warn', 'info', 'debug'],
            index: true
        },
        message: {
            type: String,
            required: true
        },
        service: {
            type: String,
            required: true,
            index: true
        },
        context: {
            type: Schema.Types.Mixed,
            default: {}
        },
        resolved: {
            type: Boolean,
            default: false,
            index: true
        },
        resolvedAt: {
            type: Date,
            required: false
        },
        resolvedBy: {
            type: String,
            required: false
        }
    },
    {
        timestamps: false, // We manage timestamp manually
        collection: 'system_logs'
    }
);

/**
 * Compound index for efficient pagination and filtering queries.
 *
 * Supports common query patterns:
 * - Newest logs first (timestamp descending)
 * - Filter by severity level
 * - Filter by resolved status
 */
systemLogSchema.index({ timestamp: -1, level: 1, resolved: 1 });

/**
 * Compound index for service-specific log queries.
 *
 * Supports filtering logs by specific service/plugin with time-range queries.
 */
systemLogSchema.index({ service: 1, timestamp: -1 });

export const SystemLog = model<ISystemLogDocument>('SystemLog', systemLogSchema);
