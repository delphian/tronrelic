/**
 * Pino log level numeric values for comparison.
 *
 * These values align with Pino's internal log level system and are used to
 * determine if a log should be written based on the configured threshold.
 *
 * **How log level filtering works:**
 *
 * A log message at a given level is output/persisted only if its numeric value
 * is >= the configured log level's numeric value.
 *
 * **Example:**
 * ```typescript
 * // If logger.level = 'warn' (40)
 * logger.trace('trace msg');  // 10 < 40 = NOT output
 * logger.debug('debug msg');  // 20 < 40 = NOT output
 * logger.info('info msg');    // 30 < 40 = NOT output
 * logger.warn('warn msg');    // 40 >= 40 = OUTPUT ✓
 * logger.error('error msg');  // 50 >= 40 = OUTPUT ✓
 * logger.fatal('fatal msg');  // 60 >= 40 = OUTPUT ✓
 * ```
 *
 * **Special level:**
 * - `silent` (Infinity) suppresses all output regardless of level
 *
 * @see https://getpino.io/#/docs/api?id=logger-level
 */
export const LOG_LEVELS = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
    silent: Infinity
} as const;

/**
 * Type representing valid log level names.
 *
 * Derived from LOG_LEVELS object keys to ensure type safety.
 */
export type LogLevelName = keyof typeof LOG_LEVELS;

/**
 * Check if a log message at a given level should be output based on the
 * configured minimum level threshold.
 *
 * **Usage:**
 * ```typescript
 * const currentLevel = 'warn';
 * if (shouldLog('error', currentLevel)) {
 *     // Error will be output (50 >= 40)
 * }
 * if (shouldLog('debug', currentLevel)) {
 *     // Debug will NOT be output (20 < 40)
 * }
 * ```
 *
 * @param messageLevel - The level of the log message being evaluated
 * @param configuredLevel - The minimum level threshold (current logger level)
 * @returns true if message should be output, false otherwise
 */
export function shouldLog(messageLevel: string, configuredLevel: string): boolean {
    const messageLevelValue = LOG_LEVELS[messageLevel as LogLevelName] ?? LOG_LEVELS.info;
    const configuredLevelValue = LOG_LEVELS[configuredLevel as LogLevelName] ?? LOG_LEVELS.info;
    return messageLevelValue >= configuredLevelValue;
}
