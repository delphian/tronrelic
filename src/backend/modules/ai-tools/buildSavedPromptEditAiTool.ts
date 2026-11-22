/**
 * @fileoverview The `ai-propose-saved-prompt-edit` AI tool: an agent proposes a
 * new body for a saved prompt, and a signed-in admin approves it in
 * `/system/curation` before anything changes.
 *
 * Saving a prompt is restricted to a signed-in admin because a body can
 * reference secret `{%name%}` variables. This tool never writes the prompt.
 * It stores a proposal and holds it under `ai-tools:saved-prompt-edit`, whose
 * approval requires a signed-in curator and shows the curator a diff.
 *
 * Who may call it:
 * - An interactive admin query on `/system/ai-tools`.
 * - An MCP client, only for a signed-in user in the `admin` group. Its `write`
 *   class already keeps it off the general `mcp-users` group; the admin check
 *   is the second gate for a narrower group cleared for restricted tools.
 * - Never a scheduled, hook-fired, or programmatic run. Those can be steered
 *   by untrusted memo, timeline, or web text, and nobody is watching.
 *
 * @module backend/modules/ai-tools/buildSavedPromptEditAiTool
 */

import type { IAiTool, IAiToolCapability, IToolEndUserPrincipal, IToolHandlerContext, ISystemLogService } from '@/types';
import type { SavedPromptsService } from './services/saved-prompts.service.js';
import {
    MAX_PENDING_PROMPT_PROPOSALS,
    SAVED_PROMPT_EDIT_CURATION_TYPE_ID,
    SavedPromptEditError,
    type ISavedPromptEditProposalResult,
    type SavedPromptEditsService
} from './services/saved-prompt-edits.service.js';
import { AI_TOOL_NAMES, findPrompt } from './buildSavedPromptAiTools.js';
import { AiToolInputError, runAiToolCall } from './runAiToolCall.js';

/**
 * The tool's name, led by `ai`, the first word of the module id. Renaming it
 * drops its stored enabled state and policy overrides, and breaks any MCP grant
 * or saved-prompt allowlist that names it.
 */
export const PROPOSE_SAVED_PROMPT_EDIT_TOOL_NAME = 'ai-propose-saved-prompt-edit';

/**
 * Classification. A `write` to the platform's own configuration, reversible
 * because an admin can edit the prompt back, and `internal` because it returns
 * only ids, names, and variable names. Self-curated: every effect is held in
 * the curation queue under `ai-tools:saved-prompt-edit`, which the governor
 * verifies against the live registration.
 */
const PROPOSE_EDIT_CAPABILITY: IAiToolCapability = {
    sideEffect: 'write',
    reversible: true,
    sensitivity: 'internal',
    forcesCuratorReview: true,
    curationTypeId: SAVED_PROMPT_EDIT_CURATION_TYPE_ID
};

/** Most find-and-replace edits one call may carry. */
const MAX_EDITS = 50;

/** Longest `find` or `replace` string accepted. */
const MAX_EDIT_CHARS = 20_000;

/** Longest body a proposal may produce. */
const MAX_BODY_CHARS = 100_000;

/** Longest reason accepted. */
const MAX_REASON_CHARS = 1_000;

/** Longest prompt id or name accepted. */
const MAX_REF_CHARS = 200;

/** Trigger paths with a person watching the run. */
const ATTENDED_PATHS = new Set<IToolHandlerContext['triggerPath']>(['interactive', 'mcp']);

/** What the model is told when a call fails for a reason that is not its input. */
const FAILURE_MESSAGE = 'Proposing the saved prompt edit failed.';

/** One find-and-replace step, after validation. */
interface IPromptEdit {
    find: string;
    replace: string;
}

/** What the tool needs from the module. */
export interface ISavedPromptEditToolDependencies {
    /** Reads the library to resolve the prompt reference. */
    savedPrompts: Pick<SavedPromptsService, 'list'>;
    /** Stores, supersedes, and holds proposals. */
    edits: Pick<SavedPromptEditsService, 'propose'>;
    /**
     * Whether a Better Auth user is in the `admin` group, resolved at call
     * time. Resolves false when the answer is unknown, so an MCP call fails
     * closed.
     */
    isAdminUser: (userId: string) => Promise<boolean>;
    /** Module logger. */
    logger: ISystemLogService;
}

/**
 * Count how many times `needle` occurs in `text`, without overlap, stopping at
 * two because the caller only needs to know whether it is exactly one.
 */
function countOccurrences(text: string, needle: string): number {
    let count = 0;
    let from = text.indexOf(needle);
    while (from !== -1 && count < 2) {
        count += 1;
        from = text.indexOf(needle, from + needle.length);
    }
    return count;
}

/**
 * Read the `edits` argument, refusing anything the model can correct.
 *
 * @param value - The raw `edits` argument.
 * @returns The validated edits, in order.
 */
function readEdits(value: unknown): IPromptEdit[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EDITS) {
        throw new AiToolInputError(`edits must be a list of 1 to ${MAX_EDITS} { find, replace } objects.`);
    }
    return value.map((entry, index) => {
        const find = (entry as { find?: unknown } | null)?.find;
        const replace = (entry as { replace?: unknown } | null)?.replace;
        if (typeof find !== 'string' || find.length === 0 || find.length > MAX_EDIT_CHARS) {
            throw new AiToolInputError(`edits[${index}].find must be a non-empty string of at most ${MAX_EDIT_CHARS} characters.`);
        }
        if (typeof replace !== 'string' || replace.length > MAX_EDIT_CHARS) {
            throw new AiToolInputError(`edits[${index}].replace must be a string of at most ${MAX_EDIT_CHARS} characters (it may be empty).`);
        }
        return { find, replace };
    });
}

/**
 * Apply find-and-replace edits in order. Each `find` must occur exactly once
 * in the text as it stands after the edits before it, so an edit can never
 * land somewhere the model did not intend.
 *
 * @param body - The current prompt body.
 * @param edits - The validated edits.
 * @returns The body after every edit.
 */
function applyEdits(body: string, edits: IPromptEdit[]): string {
    return edits.reduce((text, edit, index) => {
        const occurrences = countOccurrences(text, edit.find);
        if (occurrences !== 1) {
            throw new AiToolInputError(occurrences === 0
                ? `edits[${index}].find does not occur in the prompt body (after the edits before it). Copy the text exactly, including spaces and line breaks; read it with ${AI_TOOL_NAMES.getPrompts}.`
                : `edits[${index}].find occurs more than once in the prompt body. Include more surrounding text so it matches exactly one place.`);
        }
        return text.replace(edit.find, () => edit.replace);
    }, body);
}

/**
 * Refuse a call made on a path or by a caller this tool does not serve.
 *
 * @param principal - The trusted end user, if any.
 * @param context - The run's trigger path.
 * @param isAdminUser - The admin-group check for MCP callers.
 * @returns The proposing user's id, when known.
 */
async function authorizeCaller(
    principal: IToolEndUserPrincipal | undefined,
    context: IToolHandlerContext | undefined,
    isAdminUser: (userId: string) => Promise<boolean>
): Promise<string | undefined> {
    const triggerPath = context?.triggerPath;
    if (!triggerPath || !ATTENDED_PATHS.has(triggerPath)) {
        throw new AiToolInputError('This tool only runs in an interactive admin session or for an admin over MCP. It cannot run from a scheduled, hook-fired, or programmatic prompt.');
    }
    const userId = principal?.userId?.trim() || undefined;
    if (triggerPath === 'mcp' && (!userId || !(await isAdminUser(userId)))) {
        throw new AiToolInputError('Only an admin may propose saved prompt edits.');
    }
    return userId;
}

/**
 * Build the `ai-propose-saved-prompt-edit` tool.
 *
 * @param deps - The prompt library, the edits service, the admin check, and a logger.
 * @returns The tool to register on the core `'ai-tools'` registry.
 */
export function buildSavedPromptEditAiTool(deps: ISavedPromptEditToolDependencies): IAiTool {
    const { savedPrompts, edits, isAdminUser, logger } = deps;
    return {
        name: PROPOSE_SAVED_PROMPT_EDIT_TOOL_NAME,
        title: 'Propose a saved prompt edit',
        description:
            'Propose a change to the body of one saved prompt (a named prompt template on TronRelic\'s AI admin page). ' +
            'The prompt is NOT changed: the edit is held in the admin curation queue, where a signed-in admin sees a diff and approves or rejects it. ' +
            `Read the prompt first with ${AI_TOOL_NAMES.getPrompts} and copy text from it exactly. ` +
            'Only the body can change; the model, tool allowlist, triggers, and owner never do. ' +
            'Parameters: "prompt" (required, the prompt id or exact name), "reason" (required, why the change is wanted, shown to the reviewer), and exactly one of ' +
            '"edits" (a list of { find, replace } applied in order; each find must occur exactly once in the body as it stands after the edits before it; replace may be empty to delete) or ' +
            '"newPrompt" (the complete new body). Prefer edits for small changes. ' +
            'Proposing again for the same prompt replaces your earlier pending proposal. ' +
            `At most ${MAX_PENDING_PROMPT_PROPOSALS} proposals may wait across all prompts. ` +
            'Returns { success, pendingReview, proposalId, promptId, promptName, supersededProposals, variablesAdded, variablesRemoved, newBodyChars }; ' +
            'variablesAdded lists {%name%} tokens the new body references that the current one does not, which the reviewer will scrutinise. ' +
            'Works only in an interactive admin session or for an admin over MCP, never from a scheduled or hook-fired prompt.',
        capability: PROPOSE_EDIT_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The prompt to change, why, and the change itself.',
            properties: {
                prompt: { type: 'string', description: `The saved prompt id, or its exact name (case-insensitive). At most ${MAX_REF_CHARS} characters.` },
                reason: { type: 'string', description: `Why the change is wanted, at most ${MAX_REASON_CHARS} characters. Shown to the reviewer.` },
                edits: {
                    type: 'array',
                    description: `1 to ${MAX_EDITS} find-and-replace steps applied in order. Use instead of newPrompt.`,
                    items: {
                        type: 'object',
                        description: 'One step: the exact text to find, and what to put in its place.',
                        properties: {
                            find: { type: 'string', description: 'Exact text from the current body; must occur exactly once.' },
                            replace: { type: 'string', description: 'Replacement text; empty deletes the found text.' }
                        },
                        required: ['find', 'replace'],
                        additionalProperties: false
                    }
                },
                newPrompt: { type: 'string', description: `The complete new body, at most ${MAX_BODY_CHARS} characters. Use instead of edits.` }
            },
            required: ['prompt', 'reason'],
            additionalProperties: false
        },
        inputExamples: [
            {
                prompt: 'Memo - 8 Hours',
                reason: 'Reword the title phrases to fit the mining motif.',
                edits: [{ find: '        Found inscribed on-chain\n', replace: '        Struck in a deep seam\n' }]
            },
            {
                prompt: '3f2b9c1e-6a4d-4e8b-9f0a-1c2d3e4f5a6b',
                reason: 'Shorten the prompt and drop the retired step.',
                newPrompt: 'Summarise the last 24 hours of network activity in five bullet points.'
            }
        ],

        /**
         * Validate the caller and arguments, build the new body, and hand it to
         * the edits service, which stores and holds it.
         *
         * @param input - The model's arguments, re-validated here.
         * @param principal - The trusted end user, used for the MCP admin check and attribution.
         * @param context - The run's trigger path.
         * @returns A pending-review confirmation, or a correctable error.
         */
        handler: async (input, principal, context) => runAiToolCall(logger, PROPOSE_SAVED_PROMPT_EDIT_TOOL_NAME, FAILURE_MESSAGE, async () => {
            const proposedBy = await authorizeCaller(principal, context, isAdminUser);
            const ref = typeof input.prompt === 'string' ? input.prompt.trim() : '';
            if (!ref || ref.length > MAX_REF_CHARS) {
                throw new AiToolInputError(`prompt must be a saved prompt id or name of 1 to ${MAX_REF_CHARS} characters. Call ${AI_TOOL_NAMES.listPrompts} for the ids and names.`);
            }
            const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
            if (!reason || reason.length > MAX_REASON_CHARS) {
                throw new AiToolInputError(`reason must be a non-empty string of at most ${MAX_REASON_CHARS} characters.`);
            }
            const hasEdits = input.edits !== undefined;
            const hasNewPrompt = input.newPrompt !== undefined;
            if (hasEdits === hasNewPrompt) {
                throw new AiToolInputError('Send exactly one of edits or newPrompt.');
            }
            const prompt = findPrompt(await savedPrompts.list(), ref);
            if (!prompt) {
                throw new AiToolInputError(`No saved prompt has the id or name "${ref.slice(0, 64)}". Call ${AI_TOOL_NAMES.listPrompts} for the ids and names.`);
            }
            let newBody: string;
            if (hasEdits) {
                newBody = applyEdits(prompt.prompt, readEdits(input.edits));
            } else if (typeof input.newPrompt === 'string') {
                newBody = input.newPrompt;
            } else {
                throw new AiToolInputError('newPrompt must be a string.');
            }
            if (newBody.length > MAX_BODY_CHARS) {
                throw new AiToolInputError(`The new body would be ${newBody.length} characters; the limit is ${MAX_BODY_CHARS}.`);
            }
            let result: ISavedPromptEditProposalResult;
            try {
                result = await edits.propose({
                    promptId: prompt.id,
                    proposedPrompt: newBody,
                    reason,
                    source: `ai-tool:${PROPOSE_SAVED_PROMPT_EDIT_TOOL_NAME} (${context?.triggerPath})`,
                    proposedBy
                });
            } catch (error) {
                if (error instanceof SavedPromptEditError) {
                    throw new AiToolInputError(error.message);
                }
                throw error;
            }
            return {
                pendingReview: true,
                proposalId: result.proposal.id,
                promptId: prompt.id,
                promptName: prompt.name,
                supersededProposals: result.supersededCount,
                variablesAdded: result.variablesAdded,
                variablesRemoved: result.variablesRemoved,
                newBodyChars: result.proposal.proposedPrompt.length,
                note: 'Nothing has changed yet. A signed-in admin must approve this edit in the curation queue.'
            };
        })
    };
}
