/**
 * @file getMcpAnonymousToolIneligibility.ts
 *
 * The safety floor for tools offered to callers of the public MCP endpoint,
 * who have not signed in.
 */

import type { IAiToolCapability } from './IAiToolCapability.js';
import { getMcpToolIneligibility } from './getMcpToolIneligibility.js';

/**
 * Explain why a tool may not be offered to anonymous MCP callers, or return
 * null when it may.
 *
 * Anonymous callers are strangers, so the floor is the ordinary MCP floor plus
 * two more rules. The tool must declare `sensitivity: 'public'`, meaning
 * everything it returns could already be shown on a public page; `internal`
 * data is fine for known members but not for anyone on the internet. And it
 * must not act on a user's own objects, because an anonymous caller has no
 * account to scope them to. No group policy can waive this floor.
 *
 * The MCP module applies it when an admin grants a tool to the `anonymous`
 * group and when it builds the tool list for a public request, and the
 * governor's policy engine applies it again on every anonymous call, so the
 * three can never disagree.
 *
 * @param capability - The tool's declared capability, or undefined when the
 *   tool shipped without one.
 * @returns A sentence naming the rule the tool breaks, or null when it passes.
 */
export function getMcpAnonymousToolIneligibility(capability: IAiToolCapability | undefined): string | null {
    let reason = getMcpToolIneligibility(capability);
    if (reason === null && capability?.sensitivity !== 'public') {
        reason = `The tool's data is "${capability?.sensitivity ?? 'undeclared'}"; only tools marked public can be offered without sign-in.`;
    } else if (reason === null && capability?.operatesOnUserOwnedObjects === true) {
        reason = 'The tool acts on a signed-in user\'s own data, and an anonymous caller has no account.';
    }
    return reason;
}
