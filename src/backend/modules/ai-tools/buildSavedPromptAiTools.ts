/**
 * @fileoverview Read-only AI tools over the saved-prompt library.
 *
 * Saved prompts are named prompt templates on `/system/ai-tools`, each
 * optionally pinned to a model, narrowed to a tool allowlist, and fired by cron
 * or hook triggers. An agent asked to review, debug, or build on that library
 * needs to read it without an admin copying prompts out by hand.
 *
 * Two tools, both reads through `SavedPromptsService.list()`:
 *
 * - `ai-list-saved-prompts`: every prompt's settings and trigger health,
 *   without the prompt body or any error text.
 * - `ai-get-saved-prompts`: the full contents of up to 10 prompts, by id or
 *   name, including each trigger's last error message.
 *
 * The prompt body is returned as its stored template. `{%name%}` tokens are
 * never expanded, so a secret prompt variable referenced by a prompt stays a
 * token here. The owner's label, usually an email address, is never returned;
 * `ownerUserId` is.
 *
 * @module backend/modules/ai-tools/buildSavedPromptAiTools
 */

import type {
    IAiTool,
    IAiToolCapability,
    ISavedPrompt,
    ISavedPromptTrigger,
    ISystemLogService
} from '@/types';
import type { SavedPromptsService } from './services/saved-prompts.service.js';
import { AiToolInputError, runAiToolCall } from './runAiToolCall.js';

/**
 * Every tool's name, led by `ai`, the first word of the module id. Renaming one
 * drops its stored enabled state and policy overrides, and breaks any saved
 * prompt whose tool allowlist names it.
 */
export const AI_TOOL_NAMES = {
    listPrompts: 'ai-list-saved-prompts',
    getPrompts: 'ai-get-saved-prompts'
} as const;

/**
 * Classification of `ai-list-saved-prompts`.
 *
 * Read-only and free. `internal` because the library describes how this
 * deployment's AI runs are configured. It does not surface untrusted content:
 * it returns names, settings, and counts that an admin or the service wrote,
 * and leaves out the prompt body and every error message.
 */
const LIST_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'internal'
};

/**
 * Classification of `ai-get-saved-prompts`.
 *
 * Read-only and free. `internal` because secrets are meant to live in
 * `secret` prompt variables, which this tool leaves as unexpanded tokens.
 * `surfacesUntrustedContent` because a trigger's `lastRunError` can carry text
 * from an AI provider's error response, so the governor wraps every result as
 * data.
 */
const GET_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'internal',
    surfacesUntrustedContent: true
};

/** Most prompts one `ai-get-saved-prompts` call may ask for. */
const MAX_REFS = 10;

/** Longest id or name accepted, so an oversized argument is refused before any lookup. */
const MAX_REF_LENGTH = 200;

/** Most prompts `ai-list-saved-prompts` returns, so a large library cannot flood the context. */
const MAX_LIST = 500;

/**
 * Most characters of one prompt body returned. Ten bodies at this size stay
 * well inside a model's context window; a longer body is cut and marked
 * `promptTruncated`, with its full length still reported.
 */
const MAX_PROMPT_CHARS = 20_000;

/** Most characters of one trigger's last error message returned. */
const MAX_ERROR_CHARS = 2_000;

/** The sentence both descriptions end with, stating what the two tools share. */
const SHARED_DESCRIPTION =
    'Saved prompts are named prompt templates on TronRelic\'s AI admin page, each optionally pinned to a provider and model, narrowed to a tool allowlist, and fired automatically by cron or hook triggers. ' +
    'toolAllowlist is null when the prompt may use every enabled tool, [] when it may use none, and otherwise the tool names it may use (hosted: marks a provider-hosted tool). ' +
    'Read-only; never runs, edits, or deletes a prompt.';

/** What the model is told when a call fails for a reason that is not its input. */
const FAILURE_MESSAGE = 'The saved prompt lookup failed.';

/**
 * Describe the settings both tools return for every prompt: everything except
 * the body, the owner label, and per-trigger error text.
 *
 * @param prompt - The stored prompt.
 * @returns The shared settings fields.
 */
function toSettings(prompt: ISavedPrompt): Record<string, unknown> {
    return {
        id: prompt.id,
        name: prompt.name,
        providerId: prompt.providerId ?? null,
        model: prompt.model ?? null,
        toolAllowlist: prompt.toolAllowlist ?? null,
        ownerUserId: prompt.ownerUserId ?? null,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt
    };
}

/**
 * Describe one trigger's configuration and health, with or without its last
 * error message.
 *
 * The list tool leaves the message out so it stays free of provider text; it
 * still reports `lastRunFailed` so the model can see which prompt to open with
 * `ai-get-saved-prompts`.
 *
 * @param trigger - The stored trigger.
 * @param includeError - Whether to return the last error message.
 * @returns The trigger as the tools return it.
 */
function toTriggerView(trigger: ISavedPromptTrigger, includeError: boolean): Record<string, unknown> {
    const view: Record<string, unknown> = {
        id: trigger.id,
        kind: trigger.kind,
        enabled: trigger.enabled,
        ...(trigger.kind === 'cron'
            ? { cron: trigger.cron }
            : { hookId: trigger.hookId, typeIdFilter: trigger.typeIdFilter ?? null }),
        lastRunAt: trigger.lastRunAt ?? null,
        lastRunFailed: Boolean(trigger.lastRunError),
        failureCount: trigger.failureCount ?? 0
    };
    if (includeError) {
        const message = trigger.lastRunError ?? null;
        view.lastRunError = message && message.length > MAX_ERROR_CHARS ? message.slice(0, MAX_ERROR_CHARS) : message;
    }
    return view;
}

/**
 * Read the `prompts` argument, refusing anything the model can correct.
 *
 * @param value - The raw `prompts` argument.
 * @returns The trimmed, de-duplicated ids or names, in the order given.
 */
function readRefs(value: unknown): string[] {
    const items = Array.isArray(value)
        ? value.map(item => (typeof item === 'string' ? item.trim() : ''))
        : [];
    if (!Array.isArray(value) || items.length === 0 || items.length > MAX_REFS
        || items.some(item => item.length === 0 || item.length > MAX_REF_LENGTH)) {
        throw new AiToolInputError(`prompts must be a list of 1 to ${MAX_REFS} prompt ids or names, each at most ${MAX_REF_LENGTH} characters. Call ${AI_TOOL_NAMES.listPrompts} for the ids and names.`);
    }
    return [...new Set(items)];
}

/**
 * Find the prompt a reference names. An exact id wins; otherwise the name is
 * compared case-insensitively, which is how the service keeps names unique.
 *
 * @param prompts - Every stored prompt.
 * @param ref - The id or name the model supplied.
 * @returns The matching prompt, or undefined when none matches.
 */
function findPrompt(prompts: ISavedPrompt[], ref: string): ISavedPrompt | undefined {
    const lowered = ref.toLowerCase();
    return prompts.find(prompt => prompt.id === ref)
        ?? prompts.find(prompt => prompt.name.toLowerCase() === lowered);
}

/**
 * Build the two saved-prompt tools against the saved-prompt service.
 *
 * Takes only the service's `list` method, so a test can supply a small fake
 * and the tools cannot reach any write method.
 *
 * @param savedPrompts - The saved-prompt service the tools read through.
 * @param logger - Module-scoped logger for unexpected failures.
 * @returns The tools, in the order the admin page lists them.
 */
export function buildSavedPromptAiTools(
    savedPrompts: Pick<SavedPromptsService, 'list'>,
    logger: ISystemLogService
): IAiTool[] {
    const listPrompts: IAiTool = {
        name: AI_TOOL_NAMES.listPrompts,
        description:
            'List every saved prompt with its id, name, providerId, model, toolAllowlist, ownerUserId, createdAt, updatedAt, promptChars (length of the body), and triggers[] (kind, enabled, cron or hookId and typeIdFilter, lastRunAt, lastRunFailed, failureCount). ' +
            `Use to find a prompt before calling ${AI_TOOL_NAMES.getPrompts}, or to see which scheduled prompts are failing or paused. The prompt body and error messages are not included; ${AI_TOOL_NAMES.getPrompts} returns them. ` +
            `Takes no parameters. Returns total, returned, truncated (true when more than ${MAX_LIST} exist), and prompts[] newest-updated first. ` +
            SHARED_DESCRIPTION,
        capability: LIST_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'No parameters.',
            properties: {},
            additionalProperties: false
        },
        handler: async () => runAiToolCall(logger, AI_TOOL_NAMES.listPrompts, FAILURE_MESSAGE, async () => {
            const prompts = await savedPrompts.list();
            return {
                total: prompts.length,
                returned: Math.min(prompts.length, MAX_LIST),
                truncated: prompts.length > MAX_LIST,
                prompts: prompts.slice(0, MAX_LIST).map(prompt => ({
                    ...toSettings(prompt),
                    promptChars: prompt.prompt.length,
                    triggers: (prompt.triggers ?? []).map(trigger => toTriggerView(trigger, false))
                }))
            };
        })
    };

    const getPrompts: IAiTool = {
        name: AI_TOOL_NAMES.getPrompts,
        description:
            `Get the full contents of 1 to ${MAX_REFS} saved prompts, by id or by name (names match case-insensitively). ` +
            'Use to read what a prompt asks, check how it is configured, or find out why its trigger is failing. ' +
            `Parameters: prompts (required, 1 to ${MAX_REFS} ids or names). ` +
            `Returns prompts[], one per reference, each with status: ok (the prompt's settings, prompt — the stored template with {%name%} variable tokens unexpanded, cut to ${MAX_PROMPT_CHARS} characters with promptChars and promptTruncated — and triggers[] including lastRunError) or not-found with a reason. One unknown reference does not fail the others. ` +
            SHARED_DESCRIPTION,
        capability: GET_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The prompts to read.',
            properties: {
                prompts: {
                    type: 'array',
                    items: { type: 'string', description: 'A saved prompt id, or its exact name.' },
                    minItems: 1,
                    maxItems: MAX_REFS,
                    description: `1 to ${MAX_REFS} saved prompt ids or names.`
                }
            },
            required: ['prompts'],
            additionalProperties: false
        },
        inputExamples: [
            { prompts: ['Daily network summary'] },
            { prompts: ['3f2b9c1e-6a4d-4e8b-9f0a-1c2d3e4f5a6b', 'Blog post social draft'] }
        ],
        handler: async (input) => runAiToolCall(logger, AI_TOOL_NAMES.getPrompts, FAILURE_MESSAGE, async () => {
            const refs = readRefs(input.prompts);
            const all = await savedPrompts.list();
            return {
                prompts: refs.map(ref => {
                    const prompt = findPrompt(all, ref);
                    return prompt
                        ? {
                            ref,
                            status: 'ok',
                            ...toSettings(prompt),
                            prompt: prompt.prompt.length > MAX_PROMPT_CHARS ? prompt.prompt.slice(0, MAX_PROMPT_CHARS) : prompt.prompt,
                            promptChars: prompt.prompt.length,
                            promptTruncated: prompt.prompt.length > MAX_PROMPT_CHARS,
                            triggers: (prompt.triggers ?? []).map(trigger => toTriggerView(trigger, true))
                        }
                        : { ref, status: 'not-found', reason: `No saved prompt has the id or name "${ref.slice(0, 64)}". Call ${AI_TOOL_NAMES.listPrompts} for the ids and names.` };
                })
            };
        })
    };

    return [listPrompts, getPrompts];
}
