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
export declare const LOG_LEVELS: {
    readonly trace: 10;
    readonly debug: 20;
    readonly info: 30;
    readonly warn: 40;
    readonly error: 50;
    readonly fatal: 60;
    readonly silent: number;
};
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
export declare function shouldLog(messageLevel: string, configuredLevel: string): boolean;
//# sourceMappingURL=LogLevels.d.ts.map