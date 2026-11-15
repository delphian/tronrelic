/**
 * @fileoverview Plain-language names for the four outcomes an audited tool
 * call can have.
 *
 * The audit record stores terse codes (`ok`, `denied`, `error`,
 * `pending-approval`). Shown as-is they leave an admin guessing, for example,
 * whether `denied` means the tool ran or not. The Activity filter, the table,
 * and the detail panel all read their wording from here, so the three never
 * describe the same outcome differently. The words match the MCP usage view
 * (succeeded, refused, failed).
 */

import type { ToolInvocationStatus } from '@/types';

/** What an admin is told about one status code. */
interface IInvocationStatusText {
    /** Short label for a badge or a filter option. */
    label: string;

    /** One sentence saying whether the tool ran and what that means. */
    description: string;
}

/**
 * The wording for each status, keyed by the code stored on the record.
 */
export const invocationStatusText: Readonly<Record<ToolInvocationStatus, IInvocationStatusText>> = {
    ok: {
        label: 'Succeeded',
        description: 'The tool ran and returned a result. A tool can still report a problem inside its result, so read the result as well.'
    },
    denied: {
        label: 'Refused',
        description: 'Refused before the tool ran, by a limit, a policy, or because the tool was not available to this caller. Nothing was executed.'
    },
    error: {
        label: 'Failed',
        description: 'The tool started running and then threw an error or ran out of time.'
    },
    'pending-approval': {
        label: 'Awaiting approval',
        description: 'Held until an admin approves or rejects it on the Approvals tab of /system/ai-tools.'
    }
};
