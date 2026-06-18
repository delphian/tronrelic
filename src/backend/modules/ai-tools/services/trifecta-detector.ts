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
 * The third leg is split by whether the channel is autonomously closable. An
 * *open* egress sends with no human in the loop. A *gated* egress forces
 * honoured curator review — it can do no more than draft into a verified
 * curation queue, so a human releases every outbound effect. Per Meta's "Agents
 * Rule of Two", an agent that would span all three legs is permitted under
 * human-in-the-loop supervision, so a gated egress downgrades the danger from
 * `lethal` to `supervised` rather than removing the leg: the capability is still
 * present, only the autonomous attack path is interrupted. Supervision is
 * imperfect (a reviewer can be fooled), so `supervised` stays a caution, never
 * an all-clear.
 *
 * Detection is the visibility half of the mitigation — surface the dangerous
 * co-presence to an operator who can break the chain by disabling one leg. A
 * pure function over the supplied tool info plus an injected egress-gating
 * predicate (the policy engine's `isEgressGated`, the same fact the autonomous
 * gate enforces), so it is trivially testable and carries no I/O or provider
 * assumptions. Provider-hosted tools the model can call outside the governor
 * (e.g. a vendor `web_fetch`) are fed in by the caller via the provider-reporting
 * path (`IAiProvider.listActiveServerTools`) as ordinary `IAiToolInfo` entries —
 * a `web_fetch` arrives classified as both `surfacesUntrustedContent` (ingress)
 * and an `external` open egress leg, so it is accounted for exactly like a
 * governed tool with no special-casing here.
 */

import type { IAiToolCapability, IAiToolInfo, ITrifectaStatus } from '@/types';

/**
 * Compute the trifecta status over a registry's tool info, considering only the
 * enabled tools — a disabled tool cannot be invoked, so it cannot contribute a
 * leg. The exfiltration leg is partitioned into open (no human gate) and gated
 * (forces honoured curator review) channels via the injected predicate, which
 * drives the three-state severity.
 *
 * @param tools - Every tool's serializable info (enabled flag + capability).
 * @param isEgressGated - Predicate `(name, capability) => boolean`: does this tool
 *          open an off-platform channel gated behind honoured curator review that
 *          is not auto-approved? Supplied by the policy engine so the advisory
 *          signal credits the exact fact the autonomous gate enforces, including
 *          the admin auto-approve bypass (which un-gates the channel).
 * @returns The legs, the open/gated split of the exfiltration leg, and the
 *          three-state severity (`safe` / `supervised` / `lethal`).
 */
export function detectTrifecta(
    tools: IAiToolInfo[],
    isEgressGated: (name: string, cap: IAiToolCapability | undefined) => boolean
): ITrifectaStatus {
    const enabled = tools.filter(tool => tool.enabled);
    const privateData = enabled.filter(tool => tool.capability?.sensitivity === 'secret').map(tool => tool.name);
    const untrustedContent = enabled.filter(tool => tool.capability?.surfacesUntrustedContent === true).map(tool => tool.name);
    const external = enabled.filter(tool => tool.capability?.sideEffect === 'external');
    const exfiltration = external.map(tool => tool.name);
    const exfiltrationGated = external.filter(tool => isEgressGated(tool.name, tool.capability)).map(tool => tool.name);
    const exfiltrationOpen = external.filter(tool => !isEgressGated(tool.name, tool.capability)).map(tool => tool.name);
    const allThreePresent = privateData.length > 0 && untrustedContent.length > 0 && external.length > 0;
    const severity: ITrifectaStatus['severity'] = !allThreePresent
        ? 'safe'
        : exfiltrationOpen.length > 0
            ? 'lethal'
            : 'supervised';
    return {
        severity,
        present: severity === 'lethal',
        privateData,
        untrustedContent,
        exfiltration,
        exfiltrationOpen,
        exfiltrationGated
    };
}
