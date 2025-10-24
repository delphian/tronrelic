import pino from 'pino';
import { mkdirSync } from 'fs';
import { env } from '../config/env.js';
import { SystemLogService } from '../services/system-log/system-log.service.js';

/**
 * Logger utilities for the TronRelic backend.
 *
 * This module provides:
 * - Factory function for creating configured Pino logger instances
 * - Singleton logger export that wraps SystemLogService
 *
 * **System Log Service Architecture:**
 *
 * SystemLogService acts as both the application logger AND the MongoDB storage layer.
 * It wraps a Pino instance internally and intercepts error/warn calls to save them
 * to MongoDB before delegating to Pino for file/console output.
 *
 * **Usage:**
 *
 * ```typescript
 * import { logger } from './lib/logger.js';
 *
 * // Use directly (temporary Pino before DB connection)
 * logger.info('Starting server...');
 *
 * // After DB connection, initialize with production Pino
 * const pinoLogger = createLogger();
 * await logger.initialize(pinoLogger);
 *
 * // Now errors/warns also save to MongoDB
 * logger.error('DB failed'); // Saves to MongoDB + logs to file/console
 * ```
 */

// Ensure .run directory exists before creating logger
try {
    mkdirSync('.run', { recursive: true });
} catch (err) {
    console.error('Warning: Could not create .run directory:', err);
}

/**
 * Creates a Pino logger instance with standard TronRelic configuration.
 *
 * This factory function creates a logger that writes to both file (`.run/backend.log`)
 * and console (`pino-pretty` for readable output).
 *
 * **Transport targets:**
 *
 * 1. `pino/file` - Writes to `.run/backend.log` for local file access
 * 2. `pino-pretty` - Writes to stdout with colorized, human-readable formatting
 *
 * **Log levels:**
 *
 * - Production: `info` and above (info, warn, error)
 * - Development: `debug` and above (debug, info, warn, error)
 *
 * @returns Configured Pino logger instance
 */
export function createLogger(): pino.Logger {
    const targets: pino.TransportTargetOptions[] = [
        {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            target: 'pino/file',
            options: { destination: '.run/backend.log' }
        },
        {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            target: 'pino-pretty',
            options: {
                colorize: true,
                singleLine: false,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname'
            }
        }
    ];

    const transport = pino.transport({ targets });

    return pino(
        {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            base: {
                service: 'tronrelic-backend'
            }
        },
        transport
    );
}

/**
 * Application logger singleton.
 *
 * This is the SystemLogService instance that provides logging methods (info, warn, error, debug, child)
 * and automatically persists error/warn logs to MongoDB after initialization.
 *
 * **Before database connection:**
 * - Uses temporary Pino logger
 * - Logs only go to console
 *
 * **After database connection:**
 * - Initialize with `logger.initialize(createLogger())`
 * - Logs go to file/console via Pino
 * - Errors/warnings also save to MongoDB
 *
 * @example
 * import { logger } from './lib/logger.js';
 * logger.info('Server started');
 * logger.error({ error }, 'Failed to connect'); // Also saved to MongoDB
 */
export const logger = SystemLogService.getInstance();
