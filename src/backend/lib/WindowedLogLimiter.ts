/**
 * @fileoverview Decides whether a repeated log entry should be written, so a
 * caller who controls how often an event happens cannot fill the system log.
 *
 * Some entries are written for events an outside party triggers at will: a
 * refused OAuth app, a refused MCP tool call, an anonymous caller asked to
 * sign in. Writing one entry per event lets that party write to the log as
 * fast as they can send requests. This limiter lets each distinct key through
 * once per window, and lets only a fixed number of distinct keys through per
 * window, then reports once that the ceiling was reached.
 *
 * Facts about the limits:
 * - Windows are fixed, starting at the first event after the previous window ended.
 * - Keys are cut to a fixed length before they are remembered, so a long key
 *   cannot make the remembered set large.
 * - State is per process; two backend instances each let a key through once.
 */

/** What the caller should do with one event. */
export type LogLimiterVerdict =
    /** Write the entry: the key has not been logged in this window. */
    | 'log'
    /** Write one entry saying the ceiling was reached; returned once per window. */
    | 'ceiling-reached'
    /** Write nothing: the key was already logged, or the ceiling was already reported. */
    | 'suppressed';

/** How a limiter bounds its log. */
export interface IWindowedLogLimiterOptions {
    /** Length of one window, in milliseconds. Each key is let through once per window. */
    windowMs: number;

    /** How many distinct keys are let through per window before the ceiling applies. */
    maxKeys: number;

    /** Longest key remembered, in characters. Longer keys are cut, so two keys alike up to this length count as one. */
    maxKeyLength: number;
}

/**
 * Lets each distinct key through once per window, up to a ceiling of keys.
 *
 * A utility rather than a shared service: each component that writes an
 * outside-triggered entry builds its own instance with limits that suit it,
 * so one noisy source cannot use up another's ceiling.
 */
export class WindowedLogLimiter {
    /** When the current window began, in milliseconds since the epoch. */
    private windowStartedAt = 0;

    /** The keys already let through in the current window. */
    private readonly loggedThisWindow = new Set<string>();

    /** Whether the current window has already reported that its ceiling was reached. */
    private ceilingReported = false;

    /**
     * @param options - The window length, key ceiling, and key length cap.
     * @param now - Clock, in milliseconds. Tests supply their own to move
     *   between windows without waiting.
     */
    constructor(
        private readonly options: IWindowedLogLimiterOptions,
        private readonly now: () => number = Date.now
    ) {}

    /** The window length in whole minutes, for log entries that tell a reader how long repeats stay quiet. */
    get windowMinutes(): number {
        return Math.round(this.options.windowMs / 60_000);
    }

    /** How many distinct keys have been let through in the current window, for the ceiling entry. */
    get loggedKeys(): number {
        return this.loggedThisWindow.size;
    }

    /**
     * Decide whether the entry for one event should be written.
     *
     * Starts a new window first when the current one has ended. A key already
     * let through in this window is suppressed. A new key is let through
     * while the window has room; once it has let `maxKeys` keys through, the
     * first further new key gets `ceiling-reached` and every later one is
     * suppressed until the next window.
     *
     * @param key - What makes two events the same for logging purposes, such
     *   as a caller id and a tool name. It may contain text an outside party
     *   chose; it is only compared, never logged by this class.
     * @returns Whether to write the entry, write the ceiling entry, or write nothing.
     */
    admit(key: string): LogLimiterVerdict {
        const nowMs = this.now();
        if (nowMs - this.windowStartedAt >= this.options.windowMs) {
            this.windowStartedAt = nowMs;
            this.loggedThisWindow.clear();
            this.ceilingReported = false;
        }

        const boundedKey = key.length > this.options.maxKeyLength ? key.slice(0, this.options.maxKeyLength) : key;
        let verdict: LogLimiterVerdict = 'suppressed';
        if (!this.loggedThisWindow.has(boundedKey)) {
            if (this.loggedThisWindow.size < this.options.maxKeys) {
                this.loggedThisWindow.add(boundedKey);
                verdict = 'log';
            } else if (!this.ceilingReported) {
                this.ceilingReported = true;
                verdict = 'ceiling-reached';
            }
        }
        return verdict;
    }
}
