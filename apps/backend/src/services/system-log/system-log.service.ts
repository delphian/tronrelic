import type { ISystemLogService, ISystemLogQuery, ISystemLogPaginatedResponse, ISaveLogData, LogLevel } from '@tronrelic/types';
import { shouldLog } from '@tronrelic/types';
import { SystemLog, ISystemLogDocument } from './database/index.js';
import type pino from 'pino';

/**
 * Unified logging and system log storage service.
 *
 * This service serves dual purposes:
 * 1. **Application logger** - Provides logging methods (trace, debug, info, warn, error, fatal) used throughout the codebase
 * 2. **MongoDB storage** - Automatically persists logs to MongoDB based on configured log level
 *
 * **How it works:**
 *
 * - Wraps a Pino logger instance for file/console output
 * - ALL log methods check if the message level meets the configured threshold
 * - If the level permits, saves the log to MongoDB asynchronously BEFORE delegating to Pino
 * - Then delegates to Pino for file/console logging (Pino has its own level check)
 * - This ensures database persistence matches what appears in log files
 *
 * **Log level filtering:**
 *
 * The configured log level (from SystemConfig) controls BOTH file/console output AND
 * database persistence. For example:
 * - Level set to 'info': trace and debug are NOT saved to database or files
 * - Level set to 'debug': trace is NOT saved, but debug/info/warn/error/fatal ARE saved
 * - Level set to 'warn': only warn/error/fatal are saved to database and files
 *
 * **Usage:**
 *
 * ```typescript
 * // Get logger instance
 * const logger = SystemLogService.getInstance();
 *
 * // After database connection, initialize with Pino instance
 * await logger.initialize(pinoLogger);
 *
 * // Use like any logger - database persistence based on configured level
 * logger.trace('Detailed trace'); // Saved only if level <= 'trace'
 * logger.debug('Debug info');     // Saved only if level <= 'debug'
 * logger.info('Server started');  // Saved only if level <= 'info'
 * logger.warn('Warning');         // Saved only if level <= 'warn'
 * logger.error('Error occurred'); // Saved only if level <= 'error'
 * logger.fatal('Fatal error');    // Saved only if level <= 'fatal'
 *
 * // Create child loggers
 * const moduleLogger = logger.child({ module: 'blockchain' });
 * ```
 *
 * @implements ISystemLogService
 */
export class SystemLogService implements ISystemLogService {
    private static instance: SystemLogService;
    private initialized = false;
    private pino: pino.Logger | null = null;
    private bindings: pino.Bindings = {};

    /**
     * Private constructor enforces singleton pattern.
     *
     * The logger is null until initialized. Before initialization, logging methods
     * will fall back to console output.
     */
    private constructor() {
        // Logger will be set via initialize()
    }

    /**
     * Get the current log level.
     *
     * Returns the Pino logger's level if initialized, otherwise 'debug'.
     *
     * Available levels (from most verbose to least):
     * - 'trace' (10) - Most verbose
     * - 'debug' (20)
     * - 'info' (30)
     * - 'warn' (40)
     * - 'error' (50)
     * - 'fatal' (60)
     * - 'silent' (Infinity) - Suppresses all logs
     *
     * @returns Current log level
     */
    public get level(): pino.LevelWithSilent | string {
        return this.pino?.level ?? 'debug';
    }

    /**
     * Set the log level at runtime.
     *
     * Changes the minimum severity level for logs to be output AND persisted to MongoDB.
     * This affects both file/console output (via Pino) and database persistence.
     *
     * **Common use cases:**
     *
     * - Debugging: Set to 'debug' or 'trace' for verbose output and full database logs
     * - Production normal: Set to 'info' for standard operational logging
     * - Production quieting: Set to 'warn' to reduce noise and only capture issues
     * - Temporary silence: Set to 'silent' to suppress all file/console output (MongoDB saving also stops)
     *
     * **Example:**
     *
     * ```typescript
     * logger.level = 'warn';   // Only warn, error, fatal appear in files AND database
     * logger.level = 'debug';  // Debug, info, warn, error, fatal appear in files AND database
     * logger.level = 'silent'; // Nothing appears in files or database
     * ```
     *
     * @param level - New log level (trace, debug, info, warn, error, fatal, silent)
     */
    public set level(level: pino.LevelWithSilent | string) {
        if (this.pino) {
            this.pino.level = level;
        }
    }

    /**
     * Get the singleton instance of SystemLogService.
     *
     * @returns The shared SystemLogService instance
     */
    public static getInstance(): SystemLogService {
        if (!SystemLogService.instance) {
            SystemLogService.instance = new SystemLogService();
        }
        return SystemLogService.instance;
    }

    /**
     * Initialize the system log service with a configured Pino logger.
     *
     * Sets up the Pino logger instance for file/console output and applies the log level
     * from SystemConfig stored in the database. After initialization, error/warn logs
     * will also be saved to MongoDB.
     *
     * **Dependency Injection:**
     *
     * This method accepts a Pino logger via dependency injection instead of importing
     * it directly. This prevents circular dependencies and allows proper initialization
     * order (database connection → logger creation → SystemLogService initialization).
     *
     * **Log level configuration:**
     *
     * The log level is read from SystemConfig.logLevel in MongoDB and applied to the
     * Pino logger. This allows runtime log level changes through the admin UI without
     * requiring service restarts. If the database is unavailable or config is missing,
     * defaults to 'info' level.
     *
     * @param pinoLogger - Configured Pino logger instance (required)
     * @throws Error if pinoLogger is not provided
     */
    public async initialize(pinoLogger?: pino.Logger): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (!pinoLogger) {
            throw new Error('SystemLogService.initialize() requires a Pino logger instance');
        }

        this.pino = pinoLogger;
        this.initialized = true;

        // Apply log level from SystemConfig
        await this.applyLogLevelFromConfig();

        this.pino.info('SystemLogService initialized');
    }

    /**
     * Reads the log level from SystemConfig and applies it to the Pino logger.
     *
     * This method is called during initialization and can also be called manually
     * after updating the log level in SystemConfig to apply the change immediately.
     *
     * **Why this is async:**
     *
     * The method queries MongoDB to retrieve the SystemConfig document. To avoid
     * blocking initialization, we fetch the config asynchronously. If the query fails,
     * we log a warning but don't prevent initialization (the logger keeps its
     * current level, which defaults to 'info' from Pino's initial config).
     *
     * @returns Promise that resolves when log level has been applied
     */
    public async applyLogLevelFromConfig(): Promise<void> {
        try {
            // Import SystemConfigService dynamically to avoid circular dependencies
            const { SystemConfigService } = await import('../system-config/system-config.service.js');
            const systemConfigService = SystemConfigService.getInstance();
            const config = await systemConfigService.getConfig();

            if (config.logLevel && this.pino) {
                this.pino.level = config.logLevel;
                this.pino.info({ logLevel: config.logLevel }, 'Log level applied from SystemConfig');
            }
        } catch (error) {
            // Log to stderr to avoid infinite loops if this fails
            console.warn('Failed to apply log level from SystemConfig, using default:', error);
        }
    }

    // ========================================================================
    // Logging Methods (Application Logger Interface)
    // ========================================================================

    /**
     * Log an informational message.
     *
     * **MongoDB integration:** This method saves the log to MongoDB if the configured
     * log level permits info messages (level must be 'trace', 'debug', or 'info').
     *
     * Supports two signatures:
     * - `info(message, ...args)` - Simple message
     * - `info(obj, message, ...args)` - Structured logging with metadata
     *
     * Falls back to console.log if Pino is not initialized yet.
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    public info(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void {
        // Save to MongoDB if level permits (only if initialized)
        if (this.initialized && shouldLog('info', this.level)) {
            void this.saveLogFromArgs('info', [objOrMessage, messageOrArgs, ...args]);
        }

        // Delegate to Pino for file/console logging
        if (!this.pino) {
            console.log('[INFO]', objOrMessage, messageOrArgs, ...args);
            return;
        }

        if (typeof objOrMessage === 'string') {
            this.pino.info(objOrMessage, messageOrArgs, ...args);
        } else {
            this.pino.info(objOrMessage, messageOrArgs, ...args);
        }
    }

    /**
     * Log a warning message.
     *
     * **MongoDB integration:** This method saves the log to MongoDB if the configured
     * log level permits warning messages (level must be 'trace', 'debug', 'info', or 'warn').
     *
     * Falls back to console.warn if Pino is not initialized yet.
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    public warn(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void {
        // Save to MongoDB if level permits (only if initialized)
        if (this.initialized && shouldLog('warn', this.level)) {
            void this.saveLogFromArgs('warn', [objOrMessage, messageOrArgs, ...args]);
        }

        // Delegate to Pino for file/console logging
        if (!this.pino) {
            console.warn('[WARN]', objOrMessage, messageOrArgs, ...args);
            return;
        }

        if (typeof objOrMessage === 'string') {
            this.pino.warn(objOrMessage, messageOrArgs, ...args);
        } else {
            this.pino.warn(objOrMessage, messageOrArgs, ...args);
        }
    }

    /**
     * Log an error message.
     *
     * **MongoDB integration:** This method saves the log to MongoDB if the configured
     * log level permits error messages (level must be anything except 'silent' or 'fatal').
     *
     * Falls back to console.error if Pino is not initialized yet.
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    public error(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void {
        // Save to MongoDB if level permits (only if initialized)
        if (this.initialized && shouldLog('error', this.level)) {
            void this.saveLogFromArgs('error', [objOrMessage, messageOrArgs, ...args]);
        }

        // Delegate to Pino for file/console logging
        if (!this.pino) {
            console.error('[ERROR]', objOrMessage, messageOrArgs, ...args);
            return;
        }

        if (typeof objOrMessage === 'string') {
            this.pino.error(objOrMessage, messageOrArgs, ...args);
        } else {
            this.pino.error(objOrMessage, messageOrArgs, ...args);
        }
    }

    /**
     * Log a debug message.
     *
     * **MongoDB integration:** This method saves the log to MongoDB if the configured
     * log level permits debug messages (level must be 'trace' or 'debug').
     *
     * Falls back to console.debug if Pino is not initialized yet.
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    public debug(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void {
        // Save to MongoDB if level permits (only if initialized)
        if (this.initialized && shouldLog('debug', this.level)) {
            void this.saveLogFromArgs('debug', [objOrMessage, messageOrArgs, ...args]);
        }

        // Delegate to Pino for file/console logging
        if (!this.pino) {
            console.debug('[DEBUG]', objOrMessage, messageOrArgs, ...args);
            return;
        }

        if (typeof objOrMessage === 'string') {
            this.pino.debug(objOrMessage, messageOrArgs, ...args);
        } else {
            this.pino.debug(objOrMessage, messageOrArgs, ...args);
        }
    }

    /**
     * Log a trace message (lowest severity).
     *
     * **MongoDB integration:** This method saves the log to MongoDB if the configured
     * log level permits trace messages (level must be set to 'trace').
     *
     * Falls back to console.debug if Pino is not initialized yet.
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    public trace(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void {
        // Save to MongoDB if level permits (only if initialized)
        if (this.initialized && shouldLog('trace', this.level)) {
            void this.saveLogFromArgs('trace', [objOrMessage, messageOrArgs, ...args]);
        }

        // Delegate to Pino for file/console logging
        if (!this.pino) {
            console.debug('[TRACE]', objOrMessage, messageOrArgs, ...args);
            return;
        }

        if (typeof objOrMessage === 'string') {
            this.pino.trace(objOrMessage, messageOrArgs, ...args);
        } else {
            this.pino.trace(objOrMessage, messageOrArgs, ...args);
        }
    }

    /**
     * Log a fatal error message (highest severity).
     *
     * **MongoDB integration:** This method saves the log to MongoDB with level 'fatal'
     * if the configured log level permits (only 'silent' would prevent this).
     *
     * Falls back to console.error if Pino is not initialized yet.
     *
     * @param objOrMessage - Metadata object or message string
     * @param messageOrArgs - Message (if first arg is object) or additional args
     * @param args - Additional formatting args
     */
    public fatal(objOrMessage: string | object, messageOrArgs?: string | any, ...args: any[]): void {
        // Save to MongoDB if level permits (only if initialized)
        // Note: Fatal logs are saved with level 'fatal' (not 'error' as before)
        if (this.initialized && shouldLog('fatal', this.level)) {
            void this.saveLogFromArgs('fatal', [objOrMessage, messageOrArgs, ...args]);
        }

        // Delegate to Pino for file/console logging
        if (!this.pino) {
            console.error('[FATAL]', objOrMessage, messageOrArgs, ...args);
            return;
        }

        if (typeof objOrMessage === 'string') {
            this.pino.fatal(objOrMessage, messageOrArgs, ...args);
        } else {
            this.pino.fatal(objOrMessage, messageOrArgs, ...args);
        }
    }

    /**
     * Create a child logger with additional context bindings.
     *
     * Child loggers inherit the parent's configuration and add extra metadata
     * to all log messages. This is useful for module or service-specific logging.
     *
     * **Why this returns SystemLogService:**
     *
     * Child loggers must wrap Pino children to ensure MongoDB logging works.
     * If we returned raw Pino children, they would bypass MongoDB persistence.
     *
     * **Bindings inheritance:**
     *
     * Child loggers inherit parent bindings and merge them with new bindings.
     * These bindings are stored on the SystemLogService instance and used
     * when saving logs to MongoDB.
     *
     * @param bindings - Metadata to include in all child logger messages
     * @returns A new SystemLogService wrapping the Pino child logger
     */
    public child(bindings: pino.Bindings): SystemLogService {
        if (!this.pino) {
            // Return a child that will also use console fallback
            const childLogger = new SystemLogService();
            childLogger.initialized = this.initialized;
            childLogger.bindings = { ...this.bindings, ...bindings };
            return childLogger;
        }

        const pinoChild = this.pino.child(bindings);
        const childLogger = new SystemLogService();
        childLogger.pino = pinoChild;
        childLogger.initialized = this.initialized;
        childLogger.bindings = { ...this.bindings, ...bindings };
        return childLogger;
    }

    // ========================================================================
    // MongoDB Storage Methods (ISystemLogService Interface)
    // ========================================================================

    /**
     * Save a log entry to MongoDB.
     *
     * This method is called automatically by `error()` and `warn()` methods,
     * but can also be called manually if needed.
     *
     * @param data - Log data to save
     */
    public async saveLog(data: ISaveLogData): Promise<void> {
        try {
            const { level, message, metadata, timestamp } = data;

            // Extract service identifier from metadata
            let service = 'tronrelic-backend';
            if (metadata.service) {
                service = metadata.service;
            } else if (metadata.pluginId) {
                service = metadata.pluginId;
            } else if (metadata.pluginTitle) {
                service = metadata.pluginTitle;
            } else if (metadata.module) {
                service = `${service}:${metadata.module}`;
            }

            // Create log entry in MongoDB
            await SystemLog.create({
                timestamp,
                level,
                message,
                service,
                context: metadata,
                resolved: false
            });
        } catch (error) {
            // Log to stderr to avoid infinite loops
            console.error('Failed to save log entry to MongoDB:', error);
        }
    }

    /**
     * Parse Pino logger arguments and save to MongoDB.
     *
     * Handles Pino's multiple call signatures:
     * - logger.error(message)
     * - logger.error(obj, message)
     * - logger.error(obj, message, ...interpolationValues)
     *
     * **Metadata merging:**
     *
     * Combines child logger bindings (pluginId, pluginTitle, module, etc.)
     * with call-time metadata. Call-time metadata takes precedence.
     *
     * @param level - Log level (error or warn)
     * @param args - Arguments passed to logging method
     */
    private async saveLogFromArgs(level: LogLevel, args: any[]): Promise<void> {
        try {
            let message = 'No message provided';
            let context: Record<string, any> = {};

            // Parse Pino arguments
            if (args.length === 1) {
                if (typeof args[0] === 'string') {
                    message = args[0];
                } else if (typeof args[0] === 'object' && args[0] !== null) {
                    context = args[0];
                    message = args[0].msg || args[0].message || JSON.stringify(args[0]);
                }
            } else if (args.length >= 2) {
                if (typeof args[0] === 'object' && args[0] !== null) {
                    context = args[0];
                }
                if (typeof args[1] === 'string') {
                    message = args[1];
                }
            }

            // Merge child logger bindings with call-time metadata
            // Call-time metadata takes precedence over bindings
            const mergedMetadata = { ...this.bindings, ...context };

            await this.saveLog({
                level,
                message,
                metadata: mergedMetadata,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Failed to save log from args:', error);
        }
    }

    /**
     * Fetch system logs with pagination and filtering.
     *
     * @param query - Filter and pagination options
     * @returns Paginated logs response
     */
    public async getLogs(query: ISystemLogQuery = {}): Promise<ISystemLogPaginatedResponse> {
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
                .sort({ timestamp: -1 })
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
     * Mark a log entry as resolved.
     *
     * @param logId - MongoDB ObjectId of the log entry
     * @param resolvedBy - Admin identifier
     */
    public async markAsResolved(logId: string, resolvedBy: string): Promise<void> {
        await SystemLog.findByIdAndUpdate(
            logId,
            {
                resolved: true,
                resolvedAt: new Date(),
                resolvedBy
            },
            { new: true }
        ).exec();
    }

    /**
     * Delete old log entries based on retention policy.
     *
     * @returns Number of logs deleted
     */
    public async cleanup(): Promise<number> {
        // Implementation would read retention policy from config
        return 0;
    }

    /**
     * Get aggregate statistics about system logs.
     *
     * @returns Statistics object with counts and breakdowns
     */
    public async getStatistics(): Promise<{
        total: number;
        byLevel: Record<LogLevel, number>;
        byService: Record<string, number>;
        unresolved: number;
    }> {
        const [total, byLevel, byService, unresolved] = await Promise.all([
            SystemLog.countDocuments().exec(),
            SystemLog.aggregate([
                { $group: { _id: '$level', count: { $sum: 1 } } }
            ]).exec(),
            SystemLog.aggregate([
                { $group: { _id: '$service', count: { $sum: 1 } } }
            ]).exec(),
            SystemLog.countDocuments({ resolved: false }).exec()
        ]);

        const levelCounts: Record<LogLevel, number> = {
            trace: 0,
            debug: 0,
            info: 0,
            warn: 0,
            error: 0,
            fatal: 0
        };

        for (const item of byLevel) {
            levelCounts[item._id as LogLevel] = item.count;
        }

        const serviceCounts: Record<string, number> = {};
        for (const item of byService) {
            serviceCounts[item._id] = item.count;
        }

        return {
            total,
            byLevel: levelCounts,
            byService: serviceCounts,
            unresolved
        };
    }

    // ========================================================================
    // Additional Helper Methods (Not in ISystemLogService interface)
    // ========================================================================

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
     * Mark a log entry as unresolved.
     *
     * @param id - MongoDB document ID
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
     * @param maxCount - Maximum number of logs to retain
     * @returns Number of deleted logs
     */
    public async deleteExcessLogs(maxCount: number): Promise<number> {
        const logs = await SystemLog.find()
            .sort({ timestamp: -1 })
            .skip(maxCount)
            .limit(1)
            .lean()
            .exec();

        if (logs.length === 0) {
            return 0;
        }

        const cutoffTimestamp = logs[0].timestamp;

        const result = await SystemLog.deleteMany({
            timestamp: { $lt: cutoffTimestamp }
        }).exec();

        return result.deletedCount || 0;
    }

    /**
     * Delete all logs.
     *
     * @returns Number of deleted logs
     */
    public async deleteAllLogs(): Promise<number> {
        const result = await SystemLog.deleteMany({}).exec();
        return result.deletedCount || 0;
    }

    /**
     * Get statistics about system logs (legacy method).
     *
     * @deprecated Use getStatistics() instead
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
            trace: 0,
            debug: 0,
            info: 0,
            warn: 0,
            error: 0,
            fatal: 0
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
