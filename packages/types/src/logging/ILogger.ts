/**
 * Structured logging contract shared across backend services and plugins.
 *
 * Provides the essential logging surface so plugins can emit structured JSON
 * logs without importing platform-specific logging libraries. The interface
 * focuses on why these hooks matter: centralized telemetry needs consistent
 * severity levels and scoping so operations teams can triage issues quickly.
 * Implementations typically wrap Pino, Winston, or another structured logger
 * while preserving child logger support for scoped context.
 */
export interface ILogger {
    /**
     * Emit a fatal-level log entry.
     *
     * Fatal logs signal unrecoverable errors that terminate or significantly
     * impair the service. Implementations forward the arguments to the
     * underlying logger so structured objects remain intact.
     *
     * @param args - Structured payloads or message strings that explain the fatal failure
     */
    fatal(...args: readonly unknown[]): void;

    /**
     * Emit an error-level log entry.
     *
     * Error logs track recoverable failures that still require attention.
     * Accepts any combination of objects and strings so callers can provide
     * context while preserving stack traces.
     *
     * @param args - Structured payloads or message strings describing the error condition
     */
    error(...args: readonly unknown[]): void;

    /**
     * Emit a warning-level log entry.
     *
     * Warnings highlight unusual but non-fatal behavior such as retries or
     * degraded service. Using a dedicated method ensures these events remain
     * visible even when info-level noise is filtered out.
     *
     * @param args - Structured payloads or message strings capturing the warning details
     */
    warn(...args: readonly unknown[]): void;

    /**
     * Emit an info-level log entry.
     *
     * Info logs document normal operational milestones such as successful
     * initialization or processed work. Keeping this method available allows
     * plugins to report healthy progress without relying on debug verbosity.
     *
     * @param args - Structured payloads or message strings summarizing the event
     */
    info(...args: readonly unknown[]): void;

    /**
     * Emit a debug-level log entry.
     *
     * Debug logs capture granular diagnostic details needed during
     * troubleshooting. Implementations typically suppress these entries in
     * production environments to reduce log volume.
     *
     * @param args - Structured payloads or message strings with diagnostic context
     */
    debug(...args: readonly unknown[]): void;

    /**
     * Emit a trace-level log entry.
     *
     * Trace logs record the most verbose insights, often used for step-by-step
     * execution tracing or deep performance analysis. Most deployments disable
     * this level outside of targeted debugging sessions.
     *
     * @param args - Structured payloads or message strings describing the traced action
     */
    trace(...args: readonly unknown[]): void;

    /**
     * Create a scoped child logger with predefined bindings.
     *
     * Child loggers attach consistent metadata—such as plugin ids—to every log
     * entry without repeating bindings manually. This is critical for tracing
     * plugin activity in aggregate dashboards.
     *
     * @param bindings - Static key-value pairs automatically merged into each log entry
     * @param options - Optional logger-specific configuration such as level overrides
     * @returns A logger that inherits from the current instance while applying the bindings
     */
    child(bindings: Record<string, unknown>, options?: Record<string, unknown>): ILogger;
}
