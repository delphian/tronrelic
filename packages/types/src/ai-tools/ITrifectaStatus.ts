/**
 * @file ITrifectaStatus.ts
 *
 * Result of the lethal-trifecta check over the *enabled* AI tool set. The
 * trifecta is the co-presence of three capabilities that are each safe alone
 * but together let prompt-injected text read a secret and exfiltrate it in one
 * turn: access to private data, exposure to attacker-controlled content, and a
 * channel to send data off-platform. The governor surfaces this so an operator
 * can break the chain by disabling one leg.
 */

/**
 * The three trifecta legs over the enabled tool set, each listing the tool
 * names that contribute it, plus whether all three are present at once.
 */
export interface ITrifectaStatus {
    /** True when every leg has at least one enabled tool — the dangerous state. */
    present: boolean;

    /** Enabled tools that return secret / private data (`sensitivity: 'secret'`). */
    privateData: string[];

    /** Enabled tools that surface attacker-controlled content (`surfacesUntrustedContent`). */
    untrustedContent: string[];

    /** Enabled tools that can send data off-platform (`sideEffect: 'external'`). */
    exfiltration: string[];
}
