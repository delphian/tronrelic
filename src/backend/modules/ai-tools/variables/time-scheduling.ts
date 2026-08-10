/**
 * @file variables/time-scheduling.ts
 *
 * Built-in dynamic prompt variables in the "Time & Scheduling" category.
 * Registered by {@link registerBuiltinVariables} via registerTimeSchedulingVariables.
 *
 * These exist because a prompt that filters source material by recency otherwise
 * has to ask the model to derive its own window — "24 hours before now" — and a
 * small model gets that wrong across a date or month boundary while sounding
 * completely certain. Resolving the window in TypeScript turns the model's job
 * from arithmetic into comparison, and turns the failure mode from silent into
 * impossible.
 *
 * Unlike the other built-in categories these resolvers take no injected core
 * services: the clock is the only input, so the register function omits the
 * `IBuiltinVariableDeps` parameter its siblings carry.
 */

import type { IPromptVariableRegistry } from '@/types';

/** Span of the reporting window published by {@link registerTimeSchedulingVariables}. */
const WINDOW_HOURS = 24;

/** {@link WINDOW_HOURS} expressed in milliseconds, for the window-start subtraction. */
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Render an instant in the citation format TronRelic generated content uses, so
 * a prompt never has to restate the shape and a model never reformats an ISO
 * string by hand. Deliberately minute-resolution — seconds are noise in a
 * published citation, and omitting them here is what stops a model copying them
 * through from a source that displays them.
 *
 * @param date - The instant to render.
 * @returns The instant as `Aug 1, 02:23 UTC`.
 */
function formatCitationUtc(date: Date): string {
    const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const day = date.getUTCDate();
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const formatted = `${month} ${day}, ${hours}:${minutes} UTC`;
    return formatted;
}

/**
 * Render an instant as second-resolution ISO-8601 UTC. Milliseconds are dropped
 * so the value can be compared against an external timestamp — GitHub's
 * `published_at`, for one — as plain text: ISO-8601 UTC with zero-padded fields
 * sorts lexicographically in true chronological order, which is a comparison a
 * small model can be trusted to perform where date arithmetic is not.
 *
 * @param date - The instant to render.
 * @returns The instant as `2026-08-08T21:47:25Z`.
 */
function formatIsoUtc(date: Date): string {
    const formatted = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    return formatted;
}

/**
 * Register all "Time & Scheduling" built-in variables on the given registry.
 *
 * @param registry - The core prompt-variable registry.
 */
export function registerTimeSchedulingVariables(registry: IPromptVariableRegistry): void {
    registry.registerVariable({
        name: 'run-window-24',
        category: 'Time & Scheduling',
        description: 'Trailing 24-hour reporting window: both bounds in citation and ISO-8601 form. Use it in only one prompt per query — system or user, not both, since each expands on its own clock read',
        sensitivity: 'public',
        resolve: async () => {
            // All four lines derive from one clock read, so the bounds cannot
            // straddle a second boundary and disagree — which they could if
            // these were separate variables, since the registry resolves those
            // concurrently.
            //
            // That guarantee holds per expansion pass, not per query: the
            // system prompt and the user prompt are expanded by separate
            // `expandAll` calls (see `SystemPromptsService.compose` and the
            // provider's own expansion), so referencing this token in BOTH
            // yields two independent reads that can differ by a minute. Put it
            // in one prompt only — system or user, never both. Repeats within a
            // single prompt are safe: one `expandAll` resolves each unique name
            // once and reuses that value for every occurrence.
            const now = new Date();
            const start = new Date(now.getTime() - WINDOW_MS);

            const lines = [
                `Reporting window (trailing ${WINDOW_HOURS} hours):`,
                `  RUN_TIME:         ${formatCitationUtc(now)}`,
                `  RUN_TIME_ISO:     ${formatIsoUtc(now)}`,
                `  WINDOW_START:     ${formatCitationUtc(start)}`,
                `  WINDOW_START_ISO: ${formatIsoUtc(start)}`
            ];

            return lines.join('\n');
        }
    }, 'core');
}
