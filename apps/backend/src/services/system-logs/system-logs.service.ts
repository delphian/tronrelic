import { SystemLog, LogLevel, ISystemLogDocument } from '../../database/models/SystemLog.js';
import { logger } from '../../lib/logger.js';

/**
 * Query options for fetching system logs with pagination and filtering.
 *
 * Supports filtering by severity level, service/plugin, resolved status,
 * and time range. Used by admin API endpoints and cleanup scheduler.
 */
export interface ISystemLogsQuery {
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
export interface ISystemLogsPaginatedResponse {
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
 * Service for managing system logs in MongoDB.
 *
 * Provides CRUD operations, pagination, filtering, and cleanup functionality
 * for ERROR, WARN, INFO, and DEBUG logs captured from Pino logger instances across the application.
 *
 * This service is initialized after database connection and sets up a log
 * interceptor that writes ERROR, WARN, INFO, and DEBUG entries to MongoDB asynchronously.
 */
export class SystemLogsService {
    private static instance: SystemLogsService;
    private initialized = false;

    /**
     * Private constructor enforces singleton pattern.
     *
     * Use `SystemLogsService.getInstance()` to obtain the shared instance.
     */
    private constructor() {}

    /**
     * Get the singleton instance of SystemLogsService.
     *
     * @returns The shared SystemLogsService instance
     */
    public static getInstance(): SystemLogsService {
        if (!SystemLogsService.instance) {
            SystemLogsService.instance = new SystemLogsService();
        }
        return SystemLogsService.instance;
    }

    /**
     * Initialize the system logs interceptor.
     *
     * Wraps the global Pino logger's error() and warn() methods to intercept
     * and save logs to MongoDB asynchronously. This must be called after database
     * connection is established.
     *
     * The interceptor doesn't modify the existing logger behavior - logs still
     * go to files and stdout as before, but ERROR and WARN entries are also
     * saved to MongoDB for admin visibility.
     *
     * @throws Error if called before database connection is established
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            logger.debug('SystemLogsService already initialized');
            return;
        }

        // Wrap the logger's error, warn, info, and debug methods to capture logs to MongoDB
        const originalError = logger.error.bind(logger);
        const originalWarn = logger.warn.bind(logger);
        const originalInfo = logger.info.bind(logger);
        const originalDebug = logger.debug.bind(logger);

        // Override error method
        (logger as any).error = function(this: any, ...args: any[]) {
            // Call original error method first
            (originalError as any)(...args);

            // Extract log data and save to MongoDB asynchronously
            void SystemLogsService.getInstance().saveLogFromArgs('error', args).catch(error => {
                console.error('Failed to save error log to MongoDB:', error);
            });
        };

        // Override warn method
        (logger as any).warn = function(this: any, ...args: any[]) {
            // Call original warn method first
            (originalWarn as any)(...args);

            // Extract log data and save to MongoDB asynchronously
            void SystemLogsService.getInstance().saveLogFromArgs('warn', args).catch(error => {
                console.error('Failed to save warn log to MongoDB:', error);
            });
        };

        // Override info method
        (logger as any).info = function(this: any, ...args: any[]) {
            // Call original info method first
            (originalInfo as any)(...args);

            // Extract log data and save to MongoDB asynchronously
            void SystemLogsService.getInstance().saveLogFromArgs('info', args).catch(error => {
                console.error('Failed to save info log to MongoDB:', error);
            });
        };

        // Override debug method
        (logger as any).debug = function(this: any, ...args: any[]) {
            // Call original debug method first
            (originalDebug as any)(...args);

            // Extract log data and save to MongoDB asynchronously
            void SystemLogsService.getInstance().saveLogFromArgs('debug', args).catch(error => {
                console.error('Failed to save debug log to MongoDB:', error);
            });
        };

        this.initialized = true;
        logger.info('SystemLogsService initialized - capturing ERROR, WARN, INFO, and DEBUG logs to MongoDB');
    }

    /**
     * Extract log data from Pino logger arguments and save to MongoDB.
     *
     * Pino supports multiple call signatures:
     * - logger.error(message)
     * - logger.error(obj, message)
     * - logger.error({obj}, message, ...interpolationValues)
     *
     * This method parses the arguments to extract the message, service, and context.
     *
     * @param level - Log level (error, warn, info, or debug)
     * @param args - Arguments passed to logger.error(), logger.warn(), logger.info(), or logger.debug()
     */
    private async saveLogFromArgs(level: LogLevel, args: any[]): Promise<void> {
        try {
            let message = 'No message provided';
            let context: Record<string, any> = {};
            let service = 'tronrelic-backend';

            // Parse Pino arguments
            // https://getpino.io/#/docs/api?id=loggerlevelmergingobject-message-interpolationvalues
            if (args.length === 1) {
                // logger.error(message)
                if (typeof args[0] === 'string') {
                    message = args[0];
                } else if (typeof args[0] === 'object') {
                    // logger.error(obj) - treat object as both context and message source
                    context = args[0];
                    message = args[0].msg || args[0].message || JSON.stringify(args[0]);
                }
            } else if (args.length >= 2) {
                // logger.error(obj, message, ...interpolationValues)
                if (typeof args[0] === 'object') {
                    context = args[0];

                    // Extract service from context if present
                    if (args[0].service) {
                        service = args[0].service;
                    } else if (args[0].pluginId) {
                        service = args[0].pluginId;
                    } else if (args[0].pluginTitle) {
                        service = args[0].pluginTitle;
                    }
                }

                if (typeof args[1] === 'string') {
                    message = args[1];

                    // Handle interpolation values
                    if (args.length > 2) {
                        const interpolationValues = args.slice(2);
                        context.interpolationValues = interpolationValues;
                    }
                }
            }

            // Create log entry in MongoDB
            await SystemLog.create({
                timestamp: new Date(),
                level,
                message,
                service,
                context,
                resolved: false
            });
        } catch (error) {
            // Log to stderr to avoid infinite loops
            console.error('Failed to save log entry to MongoDB:', error);
        }
    }


    /**
     * Query system logs with pagination and filtering.
     *
     * Supports filtering by severity level, service, resolved status, and time range.
     * Returns paginated results with metadata for building admin UI pagination controls.
     *
     * @param query - Query options for filtering and pagination
     * @returns Paginated response with logs and metadata
     */
    public async getLogs(query: ISystemLogsQuery = {}): Promise<ISystemLogsPaginatedResponse> {
        const {
            levels,
            service,
            resolved,
            startDate,
            endDate,
            page = 1,
            limit = 50
        } = query;

        // Build MongoDB filter
        const filter: any = {};

        if (levels && levels.length > 0) {
            filter.level = { $in: levels };
        }

        if (service) {
            filter.service = service;
        }

        if (resolved !== undefined) {
            filter.resolved = resolved;
        }

        if (startDate || endDate) {
            filter.timestamp = {};
            if (startDate) {
                filter.timestamp.$gte = startDate;
            }
            if (endDate) {
                filter.timestamp.$lte = endDate;
            }
        }

        // Calculate pagination
        const skip = (page - 1) * limit;

        // Execute query
        const [logs, total] = await Promise.all([
            SystemLog.find(filter)
                .sort({ timestamp: -1 }) // Newest first
                .skip(skip)
                .limit(limit)
                .lean()
                .exec(),
            SystemLog.countDocuments(filter).exec()
        ]);

        const totalPages = Math.ceil(total / limit);

        return {
            logs,
            total,
            page,
            limit,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        };
    }

    /**
     * Get a single log entry by ID.
     *
     * @param id - MongoDB document ID
     * @returns Log entry or null if not found
     */
    public async getLogById(id: string): Promise<any> {
        return await SystemLog.findById(id).lean().exec();
    }

    /**
     * Mark a log entry as resolved.
     *
     * Sets the `resolved` flag to true and optionally records who resolved it
     * and when. Useful for tracking which errors have been acknowledged by admins.
     *
     * @param id - MongoDB document ID
     * @param resolvedBy - Optional username or admin token ID
     * @returns Updated log entry or null if not found
     */
    public async markAsResolved(id: string, resolvedBy?: string): Promise<any> {
        return await SystemLog.findByIdAndUpdate(
            id,
            {
                resolved: true,
                resolvedAt: new Date(),
                resolvedBy
            },
            { new: true }
        ).lean().exec();
    }

    /**
     * Mark a log entry as unresolved.
     *
     * Clears the `resolved` flag and removes resolution metadata. Useful if
     * an issue resurfaces after being marked resolved.
     *
     * @param id - MongoDB document ID
     * @returns Updated log entry or null if not found
     */
    public async markAsUnresolved(id: string): Promise<any> {
        return await SystemLog.findByIdAndUpdate(
            id,
            {
                resolved: false,
                $unset: { resolvedAt: '', resolvedBy: '' }
            },
            { new: true }
        ).lean().exec();
    }

    /**
     * Delete logs older than the specified date.
     *
     * Used by the cleanup scheduler to enforce retention policies. Returns
     * the number of deleted log entries.
     *
     * @param beforeDate - Delete logs with timestamp < beforeDate
     * @returns Number of deleted logs
     */
    public async deleteOldLogs(beforeDate: Date): Promise<number> {
        const result = await SystemLog.deleteMany({
            timestamp: { $lt: beforeDate }
        }).exec();

        return result.deletedCount || 0;
    }

    /**
     * Delete logs exceeding the maximum count limit.
     *
     * Keeps the N most recent logs and deletes older entries. Used by the
     * cleanup scheduler to enforce maximum log count policies.
     *
     * @param maxCount - Maximum number of logs to retain
     * @returns Number of deleted logs
     */
    public async deleteExcessLogs(maxCount: number): Promise<number> {
        // Get the timestamp of the Nth newest log
        const logs = await SystemLog.find()
            .sort({ timestamp: -1 })
            .skip(maxCount)
            .limit(1)
            .lean()
            .exec();

        if (logs.length === 0) {
            // We have fewer logs than maxCount, nothing to delete
            return 0;
        }

        const cutoffTimestamp = logs[0].timestamp;

        // Delete all logs older than the cutoff
        const result = await SystemLog.deleteMany({
            timestamp: { $lt: cutoffTimestamp }
        }).exec();

        return result.deletedCount || 0;
    }

    /**
     * Delete all logs.
     *
     * Used by the admin "Clear All Logs" button. This operation cannot be undone.
     *
     * @returns Number of deleted logs
     */
    public async deleteAllLogs(): Promise<number> {
        const result = await SystemLog.deleteMany({}).exec();
        return result.deletedCount || 0;
    }

    /**
     * Get statistics about system logs.
     *
     * Returns counts of logs by severity level and resolved status. Useful for
     * admin dashboard metrics.
     *
     * @returns Log statistics
     */
    public async getStats(): Promise<{
        total: number;
        byLevel: Record<LogLevel, number>;
        resolved: number;
        unresolved: number;
    }> {
        const [total, byLevel, resolved, unresolved] = await Promise.all([
            SystemLog.countDocuments().exec(),
            SystemLog.aggregate([
                { $group: { _id: '$level', count: { $sum: 1 } } }
            ]).exec(),
            SystemLog.countDocuments({ resolved: true }).exec(),
            SystemLog.countDocuments({ resolved: false }).exec()
        ]);

        const levelCounts: Record<LogLevel, number> = {
            error: 0,
            warn: 0,
            info: 0,
            debug: 0
        };

        for (const item of byLevel) {
            levelCounts[item._id as LogLevel] = item.count;
        }

        return {
            total,
            byLevel: levelCounts,
            resolved,
            unresolved
        };
    }
}
