/**
 * @file trifecta-detector.ts
 *
 * Lethal-trifecta detection over the *enabled* AI tool set. Any one capability
 * is safe alone; together they let prompt-injected text read a secret and
 * exfiltrate it in a single turn:
 *
 *   1. a private-data reader (`sensitivity: 'secret'`),
 *   2. an untrusted-content source (`surfacesUntrustedContent`), and
 *   3. an off-platform channel (`sideEffect: 'external'`).
 *
 * Detection is the visibility half of the mitigation — surface the dangerous
 * co-presence to an operator who can break the chain by disabling one leg. A
 * pure function over the registry's tool info so it is trivially testable and
 * carries no I/O or provider assumptions. Provider-hosted tools the model can
 * call outside the governor (e.g. a vendor `web_fetch`) are not in this set; a
 * future provider-reporting path feeds those in as an untrusted-content leg.
 */

import type { IAiToolInfo, ITrifectaStatus } from '@/types';

/**
 * Compute the trifecta status over a registry's tool info, considering only the
 * enabled tools — a disabled tool cannot be invoked, so it cannot contribute a
 * leg.
 *
 * @param tools - Every tool's serializable info (enabled flag + capability).
 * @returns The three legs (tool names that contribute each) and whether all
 *          three are present at once.
 */
export function detectTrifecta(tools: IAiToolInfo[]): ITrifectaStatus {
    const enabled = tools.filter(tool => tool.enabled);
    const privateData = enabled.filter(tool => tool.capability?.sensitivity === 'secret').map(tool => tool.name);
    const untrustedContent = enabled.filter(tool => tool.capability?.surfacesUntrustedContent === true).map(tool => tool.name);
    const exfiltration = enabled.filter(tool => tool.capability?.sideEffect === 'external').map(tool => tool.name);
    const present = privateData.length > 0 && untrustedContent.length > 0 && exfiltration.length > 0;
    return { present, privateData, untrustedContent, exfiltration };
}
