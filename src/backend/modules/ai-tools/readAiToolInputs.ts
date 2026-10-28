/**
 * @fileoverview Shared argument readers for the ai-tools module's own read tools.
 *
 * A tool's input schema tells the model what to send but does not guarantee
 * what arrives, so every argument is checked again in the handler. Several of
 * the module's tools take the same kinds of argument — a page size, a value
 * from a fixed list, a time window — and each check has to refuse the same
 * bad values with the same kind of message. Keeping the checks here means a
 * fix to one, such as how a timestamp is normalized, reaches every tool.
 *
 * Each reader throws {@link AiToolInputError}, which {@link runAiToolCall}
 * turns into an answer the model can correct from.
 *
 * @module backend/modules/ai-tools/readAiToolInputs
 */

import { AiToolInputError } from './runAiToolCall.js';

/**
 * Read an optional whole-number argument within a range.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, for the message.
 * @param fallback - The value used when the argument is absent.
 * @param min - The smallest accepted value.
 * @param max - The largest accepted value.
 * @returns An integer from `min` to `max`.
 */
export function readInteger(value: unknown, field: string, fallback: number, min: number, max: number): number {
    let result = fallback;
    if (value !== undefined && value !== null) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
            throw new AiToolInputError(`${field} must be a whole number from ${min} to ${max}.`);
        }
        result = value;
    }
    return result;
}

/**
 * Read an optional value that must be one of a fixed list, such as a status.
 *
 * These values go straight into a database filter, so anything outside the
 * list is refused rather than passed through.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, for the message.
 * @param allowed - The values the stored records actually hold.
 * @returns The value, or undefined when the argument is absent.
 */
export function readEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
    let result: T | undefined;
    if (value !== undefined && value !== null) {
        if (typeof value !== 'string' || !allowed.includes(value as T)) {
            throw new AiToolInputError(`${field} must be one of: ${allowed.join(', ')}.`);
        }
        result = value as T;
    }
    return result;
}

/**
 * Read an optional time bound and rewrite it in the shape records are stored in.
 *
 * The module's records store `createdAt` as `toISOString()` output and the
 * stores compare bounds as strings, so a bound in any other shape, such as one
 * with a `+02:00` offset or no milliseconds, would compare wrongly. Parsing
 * and rewriting it makes every accepted bound compare correctly.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, for the message.
 * @returns The bound as `YYYY-MM-DDTHH:mm:ss.sssZ`, or undefined when the argument is absent.
 */
export function readTimestamp(value: unknown, field: string): string | undefined {
    let result: string | undefined;
    if (value !== undefined && value !== null) {
        const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
        if (!parsed || Number.isNaN(parsed.getTime())) {
            throw new AiToolInputError(`${field} must be an ISO 8601 timestamp such as 2026-10-27T00:00:00Z.`);
        }
        result = parsed.toISOString();
    }
    return result;
}

/**
 * Read the optional `since` and `until` pair as one window, refusing a window
 * that ends before it starts.
 *
 * A reversed window would quietly match nothing, which a model would read as
 * "no activity" rather than as its own mistake.
 *
 * @param input - The raw tool arguments.
 * @returns The two normalized bounds, either of which may be undefined.
 */
export function readTimeWindow(input: Record<string, unknown>): { since?: string; until?: string } {
    const since = readTimestamp(input.since, 'since');
    const until = readTimestamp(input.until, 'until');
    if (since && until && since > until) {
        throw new AiToolInputError('since must not be later than until.');
    }
    return { since, until };
}
