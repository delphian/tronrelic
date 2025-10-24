/**
 * Log level type for system logs.
 *
 * Represents the severity of a log entry. TronRelic captures ERROR and WARN
 * levels by default via Pino transport.
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Query options for fetching system logs with pagination and filtering.
 *
 * Supports filtering by severity level, service/plugin, resolved status,
 * and time range. Used by admin API endpoints and cleanup scheduler.
 */
export interface ISystemLogQuery {
    /**
     * Log levels to include (e.g., ['error', 'warn']).
     *
     * If not specified, all levels are returned. Admin UI provides checkboxes
     * to filter by selected severity types.
     */
    levels?: LogLevel[];

    /**
     * Service or plugin ID to filter by.
     *
     * If not specified, logs from all services are returned.
     */
    service?: string;

    /**
     * Filter by resolved status.
     *
     * - `true`: Only resolved logs
     * - `false`: Only unresolved logs
     * - `undefined`: All logs
     */
    resolved?: boolean;

    /**
     * Start of time range filter.
     *
     * If specified, only logs with timestamp >= startDate are returned.
     */
    startDate?: Date;

    /**
     * End of time range filter.
     *
     * If specified, only logs with timestamp <= endDate are returned.
     */
    endDate?: Date;

    /**
     * Page number for pagination (1-indexed).
     *
     * Default: 1
     */
    page?: number;

    /**
     * Number of logs per page.
     *
     * Default: 50
     */
    limit?: number;
}

/**
 * Paginated response for system logs queries.
 *
 * Provides logs array along with pagination metadata for building
 * admin UI pagination controls.
 */
export interface ISystemLogPaginatedResponse {
    /**
     * Array of log entries for the current page.
     */
    logs: any[];

    /**
     * Total number of logs matching the query (across all pages).
     */
    total: number;

    /**
     * Current page number (1-indexed).
     */
    page: number;

    /**
     * Number of logs per page.
     */
    limit: number;

    /**
     * Total number of pages.
     */
    totalPages: number;

    /**
     * Whether there is a next page available.
     */
    hasNextPage: boolean;

    /**
     * Whether there is a previous page available.
     */
    hasPrevPage: boolean;
}

/**
 * Data required to save a log entry to MongoDB.
 *
 * Used by the Pino MongoDB transport to persist error and warning logs.
 */
export interface ISaveLogData {
    /**
     * Log severity level.
     */
    level: LogLevel;

    /**
     * Human-readable log message.
     */
    message: string;

    /**
     * Structured metadata associated with the log entry.
     *
     * Contains additional context like error stacks, request details, plugin
     * metadata, observer names, etc.
     */
    metadata: Record<string, any>;

    /**
     * Timestamp when the log was created.
     */
    timestamp: Date;
}

/**
 * System log service interface for managing application logs in MongoDB.
 *
 * Provides both logging methods (info, warn, error, debug, trace, fatal) and
 * CRUD operations for querying/managing logged entries in MongoDB.
 *
 * **Dual purpose:**
 *
 * 1. **Application logger** - Drop-in replacement for Pino with MongoDB persistence
 * 2. **Log management** - Query, filter, resolve, and cleanup logged entries
 *
 * **Usage:**
 *
 * ```typescript
 * const logger = SystemLogService.getInstance();
 * await logger.initialize(pinoInstance);
 *
 * // Use as logger (errors/warns saved to MongoDB automatically)
 * logger.info('Server started');
 * logger.error({ userId: 123 }, 'User not found'); // Also saved to MongoDB
 *
 * // Change log level at runtime
 * logger.level = 'warn'; // Suppress info/debug/trace
 * logger.level = 'debug'; // Restore debug and above
 *
 * // Query logs via service methods
 * const result = await logger.getLogs({ levels: ['error'], page: 1 });
 * ```
 */
export interface ISystemLogService {
    /**
     * Current log level.
     *
     * Controls the minimum severity for logs to be output to file/console.
     * Can be changed at runtime to adjust verbosity.
     *
     * Available levels (from most verbose to least):
     * - 'trace' (10) - Most verbose, useful for deep debugging
     * - 'debug' (20) - Development debugging information
     * - 'info' (30) - General informational messages
     * - 'warn' (40) - Warning messages
     * - 'error' (50) - Error messages
     * - 'fatal' (60) - Fatal error messages
     * - 'silent' (Infinity) - Suppresses all log output
     *
     * **Note:** MongoDB persistence for warn/error/fatal logs is NOT affected
     * by this setting - those are always saved regardless of level.
     */
    level: string;
    /**
     * Log an informational message.
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    info(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void;

    /**
     * Log a warning message (also saved to MongoDB).
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    warn(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void;

    /**
     * Log an error message (also saved to MongoDB).
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    error(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void;

    /**
     * Log a debug message.
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    debug(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void;

    /**
     * Log a trace message (lowest severity).
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    trace(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void;

    /**
     * Log a fatal error message (also saved to MongoDB).
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    fatal(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void;

    /**
     * Create a child logger with additional context bindings.
     *
     * @param bindings - Metadata to include in all child logger messages
     * @returns A new logger instance with the bindings
     */
    child(bindings: Record<string, any>): ISystemLogService;

    /**
     * Initialize the system log service.
     *
     * Prepares the service for accepting logs from the MongoDB transport.
     * Must be called after database connection is established.
     *
     * @param logger - Optional Pino logger instance for file/console output
     * @throws Error if called before database connection is established
     */
    initialize(logger?: any): Promise<void>;

    /**
     * Save a log entry to MongoDB.
     *
     * Called by the Pino MongoDB transport when warn/error logs are emitted.
     * Extracts service name from metadata, stores structured context, and
     * saves to MongoDB asynchronously.
     *
     * @param data - Log data from Pino transport
     * @returns Promise that resolves when log is saved
     */
    saveLog(data: ISaveLogData): Promise<void>;

    /**
     * Fetch system logs with pagination and filtering.
     *
     * Supports filtering by log level, service, resolved status, and time range.
     * Results are sorted by timestamp descending (newest first) and paginated.
     *
     * @param query - Filter and pagination options
     * @returns Paginated logs response
     */
    getLogs(query: ISystemLogQuery): Promise<ISystemLogPaginatedResponse>;

    /**
     * Mark a log entry as resolved.
     *
     * Sets the `resolved` flag to true and records the timestamp and resolver
     * identifier. This allows admins to acknowledge errors without deleting them.
     *
     * @param logId - MongoDB ObjectId of the log entry
     * @param resolvedBy - Admin identifier (username or token ID)
     * @returns Promise that resolves when log is marked as resolved
     */
    markAsResolved(logId: string, resolvedBy: string): Promise<void>;

    /**
     * Delete old log entries based on retention policy.
     *
     * Called by the scheduler job to enforce log retention policies. Deletes
     * logs older than the configured retention period and keeps only the most
     * recent N logs if a maximum count is set.
     *
     * @returns Number of logs deleted
     */
    cleanup(): Promise<number>;

    /**
     * Get aggregate statistics about system logs.
     *
     * Provides counts by log level, service, and resolved status for admin
     * dashboard widgets and health monitoring.
     *
     * @returns Statistics object with counts and breakdowns
     */
    getStatistics(): Promise<{
        total: number;
        byLevel: Record<LogLevel, number>;
        byService: Record<string, number>;
        unresolved: number;
    }>;

    /**
     * Get a single log entry by ID.
     *
     * @param id - MongoDB document ID
     * @returns Log entry or null if not found
     */
    getLogById(id: string): Promise<any>;

    /**
     * Mark a log entry as unresolved.
     *
     * Reverts the resolved flag and clears resolution metadata.
     *
     * @param id - MongoDB document ID
     * @returns Updated log entry or null if not found
     */
    markAsUnresolved(id: string): Promise<any>;

    /**
     * Delete all log entries.
     *
     * **Destructive operation** - Removes all logs from MongoDB.
     *
     * @returns Number of deleted logs
     */
    deleteAllLogs(): Promise<number>;

    /**
     * Get log statistics (legacy method).
     *
     * @deprecated Use getStatistics() instead
     * @returns Statistics with counts by level and resolved status
     */
    getStats(): Promise<{
        total: number;
        byLevel: Record<LogLevel, number>;
        resolved: number;
        unresolved: number;
    }>;
}
