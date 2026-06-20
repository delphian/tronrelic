/**
 * @file IContentScreenVerdict.ts
 *
 * Verdict returned by an AI provider's untrusted-content output screen. The
 * screen exists because architectural containment (the governor's provenance
 * wrap, the lethal-trifecta accounting, human approval for egress) is the right
 * primary defense but a passive one — it depends on the main model honouring the
 * "tool results are data, not instructions" rule. The screen adds an active
 * layer: the provider's cheapest model classifies a tool's attacker-influenceable
 * output, in isolation and with no tools, before the main model is allowed to act
 * on it. Because the screener has no capabilities and its output is consumed only
 * as a verdict, injected text inside the screened content can lie to it but
 * cannot make it do anything — the worst case is a wrong label, never an executed
 * instruction.
 *
 * Provider-neutral by design: every provider returns this same shape so the
 * core governor can withhold a flagged result regardless of which vendor screened
 * it. See system-ai-tools.md.
 */

/** Provider-neutral result of screening one untrusted tool result. */
export interface IContentScreenVerdict {
    /**
     * True when the screen judged the content to carry prompt-injection,
     * data-exfiltration, or agent-redirection instructions. The governor
     * withholds a flagged result from the model rather than forwarding it.
     */
    flagged: boolean;

    /**
     * Short classifier rationale, persisted to the audit record so an operator
     * can review why a result was withheld. Optional — a clean verdict need not
     * explain itself.
     */
    reason?: string;
}
