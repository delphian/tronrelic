/**
 * Framework-agnostic next function for middleware and error handling.
 *
 * This abstraction decouples plugins from Express-specific middleware patterns
 * while maintaining the same error-handling semantics. Plugins use this interface
 * instead of importing Express types directly.
 *
 * Why this abstraction exists:
 * - Plugins remain framework-independent
 * - Backend can swap HTTP libraries without breaking plugins
 * - Clear contract for middleware flow control
 * - Type-safe error propagation
 */
export interface IHttpNext {
    /**
     * Continue to the next middleware or route handler.
     *
     * Call this without arguments to pass control to the next function in the
     * middleware chain. If all middleware and handlers complete successfully,
     * the response should be sent before calling next().
     *
     * If an error occurs, pass it as an argument to skip remaining middleware
     * and route to error handling middleware.
     *
     * @param error - Optional error to trigger error handling
     *
     * @example
     * ```typescript
     * // Success - continue to next middleware
     * handler: async (req, res, next) => {
     *     console.log('Logging request');
     *     next(); // Continue to next handler
     * }
     *
     * // Error - trigger error handling
     * handler: async (req, res, next) => {
     *     try {
     *         const data = await database.find('items', {});
     *         res.json(data);
     *     } catch (error) {
     *         next(error); // Pass error to error handler
     *     }
     * }
     * ```
     */
    (error?: Error | any): void;
}
