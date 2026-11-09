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
 *
 * Two windows are published: `run-window-24` for daily prompts and
 * `run-window-7d` for weekly ones. Both come from one spec table and one
 * renderer, so they always use the same line names and formats. A weekly
 * prompt needs its own variable because the model reads the window label. A
 * weekly report given "trailing 24 hours" tends to come out reading like a
 * daily one.
 */

import type { IPromptVariableRegistry } from '@/types';

/** One hour in milliseconds, for turning a window's length into a subtraction. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Describes one trailing reporting window variable. Keeping each window as data
 * in {@link RUN_WINDOWS} means adding a window is a new table row rather than a
 * copy of the resolver.
 */
interface IRunWindowSpec {
    /** Registry name the prompt references as `{%name%}`. */
    name: string;
    /** Length of the window in hours, counted back from the run time. */
    hours: number;
    /** Plain wording of the length for the header line, such as `24 hours` or `7 days`. */
    spanLabel: string;
    /** Catalog description shown on the Registry tab and by `ai-list-prompt-variables`. */
    description: string;
}

/**
 * Advice shared by every window's description. Each `{%name%}` expansion pass
 * reads the clock separately, so the same token in the system prompt and the
 * user prompt can resolve a minute apart.
 */
const ONE_PROMPT_ADVICE = 'Use it in only one prompt per query — system or user, not both, since each expands on its own clock read';

/** Every trailing reporting window this file registers, in catalog order. */
const RUN_WINDOWS: readonly IRunWindowSpec[] = [
    {
        name: 'run-window-24',
        hours: 24,
        spanLabel: '24 hours',
        description: `Trailing 24-hour reporting window: both bounds in citation, ISO-8601, and epoch-millisecond form, plus the start date as YYYY/MM/DD. ${ONE_PROMPT_ADVICE}`
    },
    {
        name: 'run-window-7d',
        hours: 7 * 24,
        spanLabel: '7 days',
        description: `Trailing 7-day reporting window for weekly prompts: both bounds in citation, ISO-8601, and epoch-millisecond form, plus the start date as YYYY/MM/DD. ${ONE_PROMPT_ADVICE}`
    }
];

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
 * Render an instant as whole-second epoch milliseconds, for sources that stamp
 * their records with an integer instead of a date string — TronGrid's proposal
 * `create_time` and `expiration_time`, for one. Without this a prompt has to ask
 * the model to convert the window into milliseconds itself, which is the
 * arithmetic this file exists to remove. The sub-second part is dropped so the
 * value names the same instant as the ISO form beside it, and a record never
 * qualifies under one form while failing under the other.
 *
 * @param date - The instant to render.
 * @returns The instant as a 13-digit integer string such as `1787627991000`.
 */
function formatEpochMsUtc(date: Date): string {
    const wholeSecondMs = Math.floor(date.getTime() / 1000) * 1000;
    const formatted = String(wholeSecondMs);
    return formatted;
}

/**
 * Render the UTC calendar date of an instant in the `YYYY/MM/DD` shape that
 * GlobeNewswire embeds in its release URLs. That source carries no time of day,
 * so a prompt can only filter it by date, and matching the URL's own shape lets
 * the model compare the two as plain text rather than reformat either one.
 *
 * @param date - The instant whose UTC date is wanted.
 * @returns The date as `2026/08/08`.
 */
function formatSlashDateUtc(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const formatted = `${year}/${month}/${day}`;
    return formatted;
}

/**
 * Render one reporting window as the text block a prompt receives. Every line
 * comes from the single `now` passed in, so the two bounds cannot fall on
 * different sides of a second boundary and disagree. They could if each line
 * were its own variable, because the registry resolves separate variables
 * concurrently.
 *
 * That guarantee holds for one expansion pass, not for a whole query. The
 * system prompt and the user prompt are expanded by separate `expandAll` calls
 * (see `SystemPromptsService.compose` and the provider's own expansion), so a
 * token used in BOTH gets two independent clock reads that can differ by a
 * minute. Repeats within a single prompt are safe, because one `expandAll`
 * resolves each unique name once and reuses the value for every occurrence.
 *
 * The millisecond and slash-date lines serve sources whose timestamps are not
 * ISO-8601: epoch integers and dates embedded in URLs. Both millisecond bounds
 * are published because a value such as a proposal's `expiration_time` can lie
 * in the future, and a lower bound alone would let a still-open item pass as
 * decided.
 *
 * @param spec - The window being rendered, which supplies its length and label.
 * @param now - The single clock read every line is computed from.
 * @returns The multi-line window block, header line first.
 */
function renderRunWindow(spec: IRunWindowSpec, now: Date): string {
    const start = new Date(now.getTime() - spec.hours * HOUR_MS);
    const lines = [
        `Reporting window (trailing ${spec.spanLabel}):`,
        `  RUN_TIME:         ${formatCitationUtc(now)}`,
        `  RUN_TIME_ISO:     ${formatIsoUtc(now)}`,
        `  RUN_TIME_MS:      ${formatEpochMsUtc(now)}`,
        `  WINDOW_START:     ${formatCitationUtc(start)}`,
        `  WINDOW_START_ISO: ${formatIsoUtc(start)}`,
        `  WINDOW_START_MS:  ${formatEpochMsUtc(start)}`,
        `  WINDOW_START_DATE: ${formatSlashDateUtc(start)}`
    ];
    const rendered = lines.join('\n');
    return rendered;
}

/**
 * Register all "Time & Scheduling" built-in variables on the given registry.
 * Each entry in {@link RUN_WINDOWS} becomes one public dynamic variable that
 * reads the clock at the moment a prompt expands it.
 *
 * @param registry - The core prompt-variable registry the windows are added to.
 */
export function registerTimeSchedulingVariables(registry: IPromptVariableRegistry): void {
    for (const spec of RUN_WINDOWS) {
        registry.registerVariable({
            name: spec.name,
            category: 'Time & Scheduling',
            description: spec.description,
            sensitivity: 'public',
            /**
             * Resolve the window when the prompt expands, so a scheduled run
             * gets a window that ends at the moment it fired, not at boot.
             *
             * @returns The rendered window block for the current instant.
             */
            resolve: async () => {
                const rendered = renderRunWindow(spec, new Date());
                return rendered;
            }
        }, 'core');
    }
}
