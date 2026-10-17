/**
 * @fileoverview Shared error handling for the ai-tools module's own read tools.
 *
 * Every tool the module registers over its own data (prompt variables, saved
 * prompts) has to answer a model in the same two ways when something goes
 * wrong: a bad argument comes back as a message the model can correct from,
 * and any other failure comes back as a generic message while the real error
 * goes to the log. Keeping that in one place means each tool file only
 * describes its own work.
 *
 * @module backend/modules/ai-tools/runAiToolCall
 */

import type { ISystemLogService } from '@/types';

/**
 * A refusal written for the model. Thrown from validation helpers so they can
 * stay small, and turned into an `errorKind: 'input'` answer by
 * {@link runAiToolCall}.
 */
export class AiToolInputError extends Error {}

/**
 * Run one tool call, turning an input refusal into an answer the model can act
 * on and any other failure into a generic one that is logged in full.
 *
 * @param logger - Where unexpected failures are recorded.
 * @param toolName - The tool's name, for the log line.
 * @param failureMessage - What the model is told when the failure is not its input, such as "The saved prompt lookup failed."
 * @param body - The tool's work, returning the fields of a successful answer.
 * @returns `{ success: true, ... }`, or `{ success: false, error, errorKind }`.
 */
export async function runAiToolCall(
    logger: ISystemLogService,
    toolName: string,
    failureMessage: string,
    body: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
    let response: Record<string, unknown>;
    try {
        response = { success: true, ...(await body()) };
    } catch (error) {
        if (error instanceof AiToolInputError) {
            response = { success: false, error: error.message, errorKind: 'input' };
        } else {
            logger.error({ err: error, tool: toolName }, 'ai-tools AI tool failed unexpectedly');
            response = { success: false, error: `${failureMessage} This is not caused by your input; retrying later may work.`, errorKind: 'failed' };
        }
    }
    return response;
}
