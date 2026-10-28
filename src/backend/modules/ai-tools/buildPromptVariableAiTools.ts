/**
 * @fileoverview Read-only AI tools over the prompt-variable registry.
 *
 * Prompt variables are the `{%name%}` tokens core expands into a prompt before
 * it reaches the model: live system data such as `{%chain-params%}`, and
 * text an admin authored on `/system/ai-tools`. An agent writing or debugging
 * a saved prompt needs to know which variables exist and what they hold right
 * now, without an admin pasting the values in by hand.
 *
 * Two tools, both reads through `IPromptVariableRegistry`:
 *
 * - `ai-list-prompt-variables`: every variable's name, description, category,
 *   kind, and sensitivity. Runs no resolver and returns no value.
 * - `ai-get-prompt-variables`: the current value of up to 10 variables, one
 *   page at a time, with an `offset` for reading past the first page.
 *
 * A variable classified `secret` is never returned by `ai-get-prompt-variables`.
 * Its entry comes back `withheld`. Returning secrets would make the tool a
 * private-data source: it would have to be classified `secret`, which keeps it
 * off the MCP endpoint and adds a private-data leg to the lethal-trifecta
 * banner whenever it is enabled. A model that needs a secret's value already
 * gets it the intended way, by the prompt referencing `{%name%}`.
 *
 * @module backend/modules/ai-tools/buildPromptVariableAiTools
 */

import type {
    IAiTool,
    IAiToolCapability,
    IPromptVariableRegistry,
    IPromptVariableSummary,
    ISystemLogService
} from '@/types';
import { AiToolInputError, runAiToolCall } from './runAiToolCall.js';

/**
 * Every tool's name, led by `ai`, the first word of the module id. Renaming one
 * drops its stored enabled state and policy overrides, and breaks any saved
 * prompt whose tool allowlist names it.
 */
export const AI_TOOL_NAMES = {
    listVariables: 'ai-list-prompt-variables',
    getVariables: 'ai-get-prompt-variables'
} as const;

/**
 * Classification of `ai-list-prompt-variables`.
 *
 * Read-only and free. `internal` because the catalog describes how this
 * deployment is set up. It does not surface untrusted content, because every
 * name, description, and category is written either in code or by an admin.
 */
const LIST_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'internal'
};

/**
 * Classification of `ai-get-prompt-variables`.
 *
 * Read-only and free. `internal` rather than `secret` because the handler
 * withholds every `secret`-classified variable. `surfacesUntrustedContent`
 * because a dynamic variable can carry text an outsider wrote, such as a log
 * message in `{%log-summary%}`, so the governor wraps every result as data.
 */
const GET_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'internal',
    surfacesUntrustedContent: true
};

/** Most variables one `ai-get-prompt-variables` call may ask for. */
const MAX_NAMES = 10;

/**
 * Most characters of one variable's value returned per call. Ten values at this
 * size stay well inside a model's context window. A longer value is returned
 * one page at a time: the entry is marked `truncated` and carries the
 * `nextOffset` the caller passes back to read the next page.
 */
const MAX_VALUE_CHARS = 10_000;

/**
 * Highest `offset` accepted. Far beyond any value a prompt could usefully
 * carry, so it only refuses a runaway argument before any lookup.
 */
const MAX_OFFSET = 1_000_000;

/** Most variables `ai-list-prompt-variables` returns, so a large admin catalog cannot flood the context. */
const MAX_LIST = 500;

/** Longest variable name accepted, so an oversized argument is refused before any lookup. */
const MAX_NAME_LENGTH = 128;

/**
 * Characters a variable name may contain. Matches the registry's own `{%name%}`
 * pattern, which allows `:,./` for names older prompts already use.
 */
const NAME_PATTERN = /^[a-zA-Z0-9_:,./-]+$/;

/** The sentence both descriptions end with, stating what the two tools share. */
const SHARED_DESCRIPTION =
    'Prompt variables are {%name%} tokens TronRelic expands into a prompt before the model reads it: dynamic variables compute live system data, static variables hold text an admin wrote. ' +
    'Variables classified secret are listed but their values are never returned. Read-only; never changes a variable.';

/** One variable's outcome in an `ai-get-prompt-variables` result. */
interface IVariableReadResult {
    name: string;
    status: 'ok' | 'not-found' | 'withheld' | 'error';
    /** One page of the current value, starting at the requested offset. Present only for `ok`. */
    content?: string;
    /** Length of the full value in characters, the unit `offset` counts in. Present only for `ok`. */
    totalChars?: number;
    /** UTF-8 size of the full value, before any cut. Present only for `ok`. */
    sizeBytes?: number;
    /** True when the value continues past this page. Present only for `ok`. */
    truncated?: boolean;
    /** The `offset` that reads the next page, or null on the last page. Present only for `ok`. */
    nextOffset?: number | null;
    /** Why the value is missing. Present for every status except `ok`. */
    reason?: string;
}

/** What the model is told when a call fails for a reason that is not its input. */
const FAILURE_MESSAGE = 'The prompt variable lookup failed.';

/**
 * Read the `names` argument, refusing anything the model can correct.
 *
 * Accepts a name with or without its `{%` `%}` delimiters, because a model
 * copying a token out of a prompt will often include them.
 *
 * @param value - The raw `names` argument.
 * @returns The bare, de-duplicated names, in the order given.
 */
function readNames(value: unknown): string[] {
    const items = Array.isArray(value)
        ? value.map(item => (typeof item === 'string' ? item.trim().replace(/^\{%(.*)%\}$/, '$1') : ''))
        : [];
    if (!Array.isArray(value) || items.length === 0 || items.length > MAX_NAMES) {
        throw new AiToolInputError(`names must be a list of 1 to ${MAX_NAMES} variable names.`);
    }
    const invalid = items.find(name => name.length === 0 || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name));
    if (invalid !== undefined) {
        throw new AiToolInputError(
            `${JSON.stringify(invalid.slice(0, 64))} is not a variable name. Names use letters, digits, and _ : , . / - only, at most ${MAX_NAME_LENGTH} characters. Call ${AI_TOOL_NAMES.listVariables} for the exact names.`
        );
    }
    return [...new Set(items)];
}

/**
 * Read the optional `offset` argument, refusing anything the model can correct.
 *
 * Without an offset there is no way to read past the first page of a long
 * value, so this is what makes a value longer than {@link MAX_VALUE_CHARS}
 * readable at all. Absent means the start of the value.
 *
 * @param value - The raw `offset` argument.
 * @returns The character position each requested value is read from.
 */
function readOffset(value: unknown): number {
    let result = 0;
    if (value !== undefined && value !== null) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_OFFSET) {
            throw new AiToolInputError(`offset must be a whole number from 0 to ${MAX_OFFSET}. Pass the nextOffset from the previous call to continue a value.`);
        }
        result = value;
    }
    return result;
}

/**
 * Cut one page out of a value, starting at `offset`.
 *
 * The page never ends between the two halves of a UTF-16 surrogate pair, such
 * as an emoji. Splitting one would leave an unpaired half at the end of this
 * page and at the start of the next, and both would reach the model as
 * replacement characters.
 *
 * @param value - The variable's full current value.
 * @param offset - Where the page starts, in characters.
 * @returns The page text, and the offset of the next page or null when this page reaches the end.
 */
function pageOf(value: string, offset: number): { content: string; nextOffset: number | null } {
    const start = Math.min(offset, value.length);
    let end = Math.min(start + MAX_VALUE_CHARS, value.length);
    if (end < value.length && end > start) {
        const last = value.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) {
            end -= 1;
        }
    }
    return { content: value.slice(start, end), nextOffset: end < value.length ? end : null };
}

/**
 * Turn a registry summary into what `ai-list-prompt-variables` returns.
 *
 * Adds `readable` so the model can tell before calling
 * `ai-get-prompt-variables` which values it will be given.
 *
 * @param summary - The variable's summary from the registry.
 * @returns The listing entry.
 */
function toListEntry(summary: IPromptVariableSummary): Record<string, unknown> {
    return {
        name: summary.name,
        pattern: summary.pattern,
        description: summary.description,
        category: summary.category,
        kind: summary.kind,
        sensitivity: summary.sensitivity,
        readable: summary.sensitivity !== 'secret'
    };
}

/**
 * Resolve one requested variable into its result entry.
 *
 * The secret check uses the summary taken at the start of the call, so a
 * variable is withheld before its resolver ever runs. A resolver failure is
 * logged in full and reported to the model as a generic reason, since the
 * underlying error can name internal hosts or services.
 *
 * @param registry - Where the value is resolved.
 * @param logger - Where resolver failures are recorded.
 * @param name - The bare variable name.
 * @param summary - The variable's summary, or undefined when no such variable exists.
 * @param offset - Where in the value to start reading, so a caller can page through a long one.
 * @returns The variable's outcome.
 */
async function readOne(
    registry: Pick<IPromptVariableRegistry, 'resolve'>,
    logger: ISystemLogService,
    name: string,
    summary: IPromptVariableSummary | undefined,
    offset: number
): Promise<IVariableReadResult> {
    let result: IVariableReadResult;
    if (!summary) {
        result = { name, status: 'not-found', reason: `No variable is named "${name}". Call ${AI_TOOL_NAMES.listVariables} for the exact names.` };
    } else if (summary.sensitivity === 'secret') {
        result = { name, status: 'withheld', reason: 'This variable is classified secret, so its value is never returned by a tool. An admin can reclassify it on the Registry tab of /system/ai-tools.' };
    } else {
        try {
            const value = await registry.resolve(name);
            const page = pageOf(value, offset);
            result = {
                name,
                status: 'ok',
                content: page.content,
                totalChars: value.length,
                sizeBytes: Buffer.byteLength(value, 'utf-8'),
                truncated: page.nextOffset !== null,
                nextOffset: page.nextOffset
            };
        } catch (error) {
            logger.warn({ err: error, variable: name, tool: AI_TOOL_NAMES.getVariables }, `Prompt variable "${name}" failed to resolve for an AI tool`);
            result = { name, status: 'error', reason: 'The variable failed to compute its value. This is not caused by your input; retrying later may work.' };
        }
    }
    return result;
}

/**
 * Build the two prompt-variable tools against the registry.
 *
 * Takes only the two registry methods the tools call, so a test can supply a
 * small fake and the tools cannot reach the registry's write methods.
 *
 * @param registry - The prompt-variable registry the tools read through.
 * @param logger - Module-scoped logger for resolver and unexpected failures.
 * @returns The tools, in the order the admin page lists them.
 */
export function buildPromptVariableAiTools(
    registry: Pick<IPromptVariableRegistry, 'listSummaries' | 'resolve'>,
    logger: ISystemLogService
): IAiTool[] {
    const listVariables: IAiTool = {
        name: AI_TOOL_NAMES.listVariables,
        description:
            'List every prompt variable TronRelic can expand, with its name, {%name%} pattern, description, category, kind (dynamic or static), sensitivity (public, internal, or secret), and readable. ' +
            `Use to find which variables exist before writing a prompt that references them, or before calling ${AI_TOOL_NAMES.getVariables}. ` +
            `readable is false for a secret variable, whose value ${AI_TOOL_NAMES.getVariables} will not return. ` +
            `Takes no parameters. Returns total, returned, truncated (true when more than ${MAX_LIST} exist), and variables[] sorted by category then name. Values are never included. ` +
            SHARED_DESCRIPTION,
        capability: LIST_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'No parameters.',
            properties: {},
            additionalProperties: false
        },
        handler: async () => runAiToolCall(logger, AI_TOOL_NAMES.listVariables, FAILURE_MESSAGE, async () => {
            const summaries = registry.listSummaries();
            return {
                total: summaries.length,
                returned: Math.min(summaries.length, MAX_LIST),
                truncated: summaries.length > MAX_LIST,
                variables: summaries.slice(0, MAX_LIST).map(toListEntry)
            };
        })
    };

    const getVariables: IAiTool = {
        name: AI_TOOL_NAMES.getVariables,
        description:
            `Get the current value of 1 to ${MAX_NAMES} prompt variables, exactly as a prompt referencing {%name%} would receive it now. ` +
            'Use to check what a variable contains before relying on it in a prompt, or to read live data a variable already computes. ' +
            `Parameters: names (required, 1 to ${MAX_NAMES} variable names, with or without the {% %} delimiters); offset (optional, default 0, the character position to start reading each value from). ` +
            `Each value is returned ${MAX_VALUE_CHARS} characters at a time. When truncated is true, call again with that one name and offset set to its nextOffset to read the next page, and repeat until nextOffset is null. ` +
            'Returns variables[], one per name, each with status: ok (content for this page, totalChars and sizeBytes of the full value, truncated, and nextOffset), not-found, withheld (classified secret), or error (the variable failed to compute). Each non-ok entry carries a reason. One bad name does not fail the others. ' +
            SHARED_DESCRIPTION,
        capability: GET_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The variables to read.',
            properties: {
                names: {
                    type: 'array',
                    items: { type: 'string', description: 'A variable name such as "chain-params", or its pattern "{%chain-params%}".' },
                    minItems: 1,
                    maxItems: MAX_NAMES,
                    description: `1 to ${MAX_NAMES} variable names.`
                },
                offset: {
                    type: 'integer',
                    minimum: 0,
                    maximum: MAX_OFFSET,
                    description: 'Character position to start reading each value from, default 0. Pass the previous call\'s nextOffset to read the next page of a long value.'
                }
            },
            required: ['names'],
            additionalProperties: false
        },
        inputExamples: [
            { names: ['chain-params'] },
            { names: ['system-status', '{%observer-stats%}', 'site-info'] },
            { names: ['news-source-urls'], offset: MAX_VALUE_CHARS }
        ],
        handler: async (input) => runAiToolCall(logger, AI_TOOL_NAMES.getVariables, FAILURE_MESSAGE, async () => {
            const names = readNames(input.names);
            const offset = readOffset(input.offset);
            const byName = new Map(registry.listSummaries().map(summary => [summary.name, summary]));
            const variables = await Promise.all(names.map(name => readOne(registry, logger, name, byName.get(name), offset)));
            return { variables };
        })
    };

    return [listVariables, getVariables];
}
