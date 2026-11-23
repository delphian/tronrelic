/**
 * @fileoverview The `ai-propose-prompt-variable-edit` AI tool: an agent
 * proposes new text for an admin-authored (static) prompt variable, and a
 * signed-in admin approves it in `/system/curation` before anything changes.
 *
 * A variable's text splices into every prompt that references `{%name%}`, so
 * one edit reaches every one of those prompts on its next run. This tool never
 * writes the variable. It stores a proposal and holds it under
 * `ai-tools:prompt-variable-edit`, whose approval requires a signed-in curator
 * and shows the curator a diff.
 *
 * Limits:
 * - Static variables only; built-in (dynamic) variables compute their value in code.
 * - Not a `secret` variable; the read tools withhold those values.
 * - Who may call it is decided by `authorizeProposalCaller`: an interactive
 *   admin query, or an admin over MCP, and never an unattended run.
 *
 * @module backend/modules/ai-tools/buildPromptVariableEditAiTool
 */

import type { IAiTool, IAiToolCapability, ISystemLogService } from '@/types';
import type { PromptVariableRegistry } from './services/prompt-variable-registry.js';
import {
    MAX_PENDING_VARIABLE_PROPOSALS,
    PROMPT_VARIABLE_EDIT_CURATION_TYPE_ID,
    PromptVariableEditError,
    type IPromptVariableEditProposalResult,
    type PromptVariableEditsService
} from './services/PromptVariableEditsService.js';
import { AI_TOOL_NAMES } from './buildPromptVariableAiTools.js';
import { AiToolInputError, runAiToolCall } from './runAiToolCall.js';
import { MAX_TEXT_EDITS, applyTextEdits, readTextEdits } from './applyTextEdits.js';
import { authorizeProposalCaller } from './authorizeProposalCaller.js';

/**
 * The tool's name, led by `ai`, the first word of the module id. Renaming it
 * drops its stored enabled state and policy overrides, and breaks any MCP grant
 * or saved-prompt allowlist that names it.
 */
export const PROPOSE_PROMPT_VARIABLE_EDIT_TOOL_NAME = 'ai-propose-prompt-variable-edit';

/**
 * Classification. A `write` to the platform's own configuration, reversible
 * because an admin can edit the variable back, and `internal` because it
 * returns only names and counts, never a variable's value. Self-curated: every
 * effect is held in the curation queue under `ai-tools:prompt-variable-edit`,
 * which the governor verifies against the live registration.
 */
const PROPOSE_EDIT_CAPABILITY: IAiToolCapability = {
    sideEffect: 'write',
    reversible: true,
    sensitivity: 'internal',
    forcesCuratorReview: true,
    curationTypeId: PROMPT_VARIABLE_EDIT_CURATION_TYPE_ID
};

/** Longest text a proposal may produce. */
const MAX_CONTENT_CHARS = 100_000;

/** Longest reason accepted. */
const MAX_REASON_CHARS = 1_000;

/** The shape of an admin-authored variable name, the same rule the registry applies on create. */
const STATIC_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** What the model is told when a call fails for a reason that is not its input. */
const FAILURE_MESSAGE = 'Proposing the prompt variable edit failed.';

/** What the tool needs from the module. */
export interface IPromptVariableEditToolDependencies {
    /** Reads the variable's current text, for find-and-replace edits. */
    variables: Pick<PromptVariableRegistry, 'getStatic'>;
    /** Stores, supersedes, and holds proposals. */
    edits: Pick<PromptVariableEditsService, 'propose'>;
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
 * Read the `variable` argument, accepting the bare name or the `{%name%}`
 * pattern, since models copy either from the listing.
 *
 * @param value - The raw `variable` argument.
 * @returns The bare variable name.
 */
function readVariableName(value: unknown): string {
    const raw = typeof value === 'string' ? value.trim() : '';
    const name = raw.startsWith('{%') && raw.endsWith('%}') ? raw.slice(2, -2).trim() : raw;
    if (!STATIC_NAME_PATTERN.test(name)) {
        throw new AiToolInputError(`variable must be an admin-authored variable name such as "news-source-urls" or "{%news-source-urls%}". Call ${AI_TOOL_NAMES.listVariables} for the names; only kind "static" can be edited.`);
    }
    return name;
}

/**
 * Build the `ai-propose-prompt-variable-edit` tool.
 *
 * @param deps - The variable registry, the edits service, the admin check, and a logger.
 * @returns The tool to register on the core `'ai-tools'` registry.
 */
export function buildPromptVariableEditAiTool(deps: IPromptVariableEditToolDependencies): IAiTool {
    const { variables, edits, isAdminUser, logger } = deps;
    return {
        name: PROPOSE_PROMPT_VARIABLE_EDIT_TOOL_NAME,
        title: 'Propose a prompt variable edit',
        description:
            'Propose new text for one admin-authored prompt variable (a {%name%} token whose text TronRelic splices into every prompt that references it). ' +
            'The variable is NOT changed: the edit is held in the admin curation queue, where a signed-in admin sees a diff and approves or rejects it. ' +
            `Only variables of kind "static" in ${AI_TOOL_NAMES.listVariables} can be edited, and not ones classified secret. ` +
            `Read the current text first with ${AI_TOOL_NAMES.getVariables} (page through it with offset if it is long) and copy text from it exactly. ` +
            'Only the text can change; the name, description, category, and sensitivity never do. ' +
            'Parameters: "variable" (required, the name with or without {% %}), "reason" (required, why the change is wanted, shown to the reviewer), and exactly one of ' +
            '"edits" (a list of { find, replace } applied in order; each find must occur exactly once in the text as it stands after the edits before it; replace may be empty to delete) or ' +
            '"newContent" (the complete new text). Prefer edits for small changes to long text. ' +
            'Proposing again for the same variable replaces your earlier pending proposal. ' +
            `At most ${MAX_PENDING_VARIABLE_PROPOSALS} variable proposals may wait at once. ` +
            'Returns { success, pendingReview, proposalId, variable, supersededProposals, referencedBy, newContentChars }; ' +
            'referencedBy names the saved prompts whose body references the variable, which the change reaches once approved. ' +
            'Works only in an interactive admin session or for an admin over MCP, never from a scheduled or hook-fired prompt.',
        capability: PROPOSE_EDIT_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The variable to change, why, and the change itself.',
            properties: {
                variable: { type: 'string', description: 'The variable name, such as "news-source-urls" or "{%news-source-urls%}".' },
                reason: { type: 'string', description: `Why the change is wanted, at most ${MAX_REASON_CHARS} characters. Shown to the reviewer.` },
                edits: {
                    type: 'array',
                    description: `1 to ${MAX_TEXT_EDITS} find-and-replace steps applied in order. Use instead of newContent.`,
                    items: {
                        type: 'object',
                        description: 'One step: the exact text to find, and what to put in its place.',
                        properties: {
                            find: { type: 'string', description: 'Exact text from the current value; must occur exactly once.' },
                            replace: { type: 'string', description: 'Replacement text; empty deletes the found text.' }
                        },
                        required: ['find', 'replace'],
                        additionalProperties: false
                    }
                },
                newContent: { type: 'string', description: `The complete new text, at most ${MAX_CONTENT_CHARS} characters. Use instead of edits.` }
            },
            required: ['variable', 'reason'],
            additionalProperties: false
        },
        inputExamples: [
            {
                variable: 'news-source-urls',
                reason: 'Drop forum topics that promote the poster\'s own product after the first mention.',
                edits: [{ find: '      Select: keep items that carry TRON news', replace: '      Own-product topics: drop them once covered.\n      Select: keep items that carry TRON news' }]
            },
            {
                variable: '{%house-style%}',
                reason: 'Replace the style guide with the shorter version.',
                newContent: 'Write in plain English. Cite every figure. Never speculate about motive.'
            }
        ],

        /**
         * Validate the caller and arguments, build the new text, and hand it to
         * the edits service, which stores and holds it.
         *
         * @param input - The model's arguments, re-validated here.
         * @param principal - The trusted end user, used for the MCP admin check and attribution.
         * @param context - The run's trigger path.
         * @returns A pending-review confirmation, or a correctable error.
         */
        handler: async (input, principal, context) => runAiToolCall(logger, PROPOSE_PROMPT_VARIABLE_EDIT_TOOL_NAME, FAILURE_MESSAGE, async () => {
            const proposedBy = await authorizeProposalCaller(principal, context, isAdminUser, 'prompt variable edits');
            const name = readVariableName(input.variable);
            const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
            if (!reason || reason.length > MAX_REASON_CHARS) {
                throw new AiToolInputError(`reason must be a non-empty string of at most ${MAX_REASON_CHARS} characters.`);
            }
            const hasEdits = input.edits !== undefined;
            const hasNewContent = input.newContent !== undefined;
            if (hasEdits === hasNewContent) {
                throw new AiToolInputError('Send exactly one of edits or newContent.');
            }
            const variable = variables.getStatic(name);
            if (!variable) {
                throw new AiToolInputError(`No admin-authored variable is named "${name}". Call ${AI_TOOL_NAMES.listVariables}; only kind "static" can be edited.`);
            }
            if (variable.sensitivity === 'secret') {
                throw new AiToolInputError(`{%${name}%} is classified secret, so its text cannot be read or proposed against. An admin can edit it on /system/ai-tools.`);
            }
            let newContent: string;
            if (hasEdits) {
                newContent = applyTextEdits(variable.content, readTextEdits(input.edits), { noun: 'the variable\'s text', readTool: AI_TOOL_NAMES.getVariables });
            } else if (typeof input.newContent === 'string') {
                newContent = input.newContent;
            } else {
                throw new AiToolInputError('newContent must be a string.');
            }
            if (newContent.length > MAX_CONTENT_CHARS) {
                throw new AiToolInputError(`The new text would be ${newContent.length} characters; the limit is ${MAX_CONTENT_CHARS}.`);
            }
            let result: IPromptVariableEditProposalResult;
            try {
                result = await edits.propose({
                    variableName: name,
                    proposedContent: newContent,
                    reason,
                    source: `ai-tool:${PROPOSE_PROMPT_VARIABLE_EDIT_TOOL_NAME} (${context?.triggerPath})`,
                    proposedBy
                });
            } catch (error) {
                if (error instanceof PromptVariableEditError) {
                    throw new AiToolInputError(error.message);
                }
                throw error;
            }
            return {
                pendingReview: true,
                proposalId: result.proposal.id,
                variable: `{%${name}%}`,
                supersededProposals: result.supersededCount,
                referencedBy: result.referencedBy,
                newContentChars: result.proposal.proposedContent.length,
                note: 'Nothing has changed yet. A signed-in admin must approve this edit in the curation queue.'
            };
        })
    };
}
