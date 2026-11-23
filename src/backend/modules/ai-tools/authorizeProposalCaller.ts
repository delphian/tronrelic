/**
 * @fileoverview The caller check every propose tool in this module runs first.
 *
 * A proposal changes this module's own configuration once approved, so the
 * tools that make one serve only callers with a person watching:
 * - An interactive admin query on `/system/ai-tools`.
 * - An MCP client, only for a signed-in user in the `admin` group. The tools'
 *   `write` class already keeps them off the general `mcp-users` group; this
 *   check is the second gate for a narrower group cleared for restricted tools.
 * - Never a scheduled, hook-fired, or programmatic run. Those can be steered
 *   by untrusted memo, timeline, or web text, and nobody is watching.
 *
 * @module backend/modules/ai-tools/authorizeProposalCaller
 */

import type { IToolEndUserPrincipal, IToolHandlerContext } from '@/types';
import { AiToolInputError } from './runAiToolCall.js';

/** Trigger paths with a person watching the run. */
const ATTENDED_PATHS = new Set<IToolHandlerContext['triggerPath']>(['interactive', 'mcp']);

/**
 * Refuse a call made on a path or by a caller the propose tools do not serve.
 *
 * @param principal - The trusted end user from the governor, if any.
 * @param context - The run's trigger path.
 * @param isAdminUser - The admin-group check for MCP callers; resolves false when the answer is unknown.
 * @param subject - What the tool proposes, such as `saved prompt edits`, for the refusal message.
 * @returns The proposing user's id when known, for attribution on the proposal.
 */
export async function authorizeProposalCaller(
    principal: IToolEndUserPrincipal | undefined,
    context: IToolHandlerContext | undefined,
    isAdminUser: (userId: string) => Promise<boolean>,
    subject: string
): Promise<string | undefined> {
    const triggerPath = context?.triggerPath;
    if (!triggerPath || !ATTENDED_PATHS.has(triggerPath)) {
        throw new AiToolInputError('This tool only runs in an interactive admin session or for an admin over MCP. It cannot run from a scheduled, hook-fired, or programmatic prompt.');
    }
    const userId = principal?.userId?.trim() || undefined;
    if (triggerPath === 'mcp' && (!userId || !(await isAdminUser(userId)))) {
        throw new AiToolInputError(`Only an admin may propose ${subject}.`);
    }
    return userId;
}
