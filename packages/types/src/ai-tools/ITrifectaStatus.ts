/**
 * @file ITrifectaStatus.ts
 *
 * Result of the lethal-trifecta check over the *enabled* AI tool set. The
 * trifecta is the co-presence of three capabilities that are each safe alone
 * but together let prompt-injected text read a secret and exfiltrate it in one
 * turn: access to private data, exposure to attacker-controlled content, and a
 * channel to send data off-platform. The governor surfaces this so an operator
 * can break the chain by disabling one leg.
 *
 * The exfiltration leg is partitioned by whether the channel is autonomously
 * closable. A *gated* channel forces honoured curator review — it can do no more
 * than draft into a verified curation queue before a human releases it — which,
 * per Meta's "Agents Rule of Two", is the supervised escape hatch for an agent
 * that would otherwise span all three legs. So a fully-gated egress downgrades
 * the state from `lethal` to `supervised` rather than removing the leg.
 */

/**
 * Three-state severity over the enabled tool set:
 * - `safe` — at least one leg is absent.
 * - `supervised` — all three capabilities are present, but every off-platform
 *   channel forces honoured curator review, so injected text cannot exfiltrate
 *   autonomously: a human releases each outbound effect. Residual risk remains
 *   (a reviewer can be fooled), so this is a caution, not an all-clear.
 * - `lethal` — all three present with at least one *open* (non-curator-gated)
 *   egress channel: the autonomously closable attack path.
 */
export type TrifectaSeverity = 'safe' | 'supervised' | 'lethal';

/**
 * The three trifecta legs over the enabled tool set, each listing the tool
 * names that contribute it, the open/gated split of the exfiltration leg, and
 * the three-state severity.
 */
export interface ITrifectaStatus {
    /** Three-state danger level over the enabled set. See {@link TrifectaSeverity}. */
    severity: TrifectaSeverity;

    /** True only when `severity === 'lethal'`. Retained for callers reading the old boolean. */
    present: boolean;

    /** Enabled tools that return secret / private data (`sensitivity: 'secret'`). */
    privateData: string[];

    /** Enabled tools that surface attacker-controlled content (`surfacesUntrustedContent`). */
    untrustedContent: string[];

    /** Every enabled external tool — the union of `exfiltrationOpen` and `exfiltrationGated`. */
    exfiltration: string[];

    /** External tools whose egress is NOT curator-gated — the autonomously closable exfiltration leg. */
    exfiltrationOpen: string[];

    /** External tools whose egress forces honoured curator review — supervised, not autonomously closable. */
    exfiltrationGated: string[];
}
