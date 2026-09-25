/**
 * @fileoverview Flagging counterparties that look like address poisoning.
 *
 * Address poisoning works by sending a zero-value or dust transfer from an
 * address whose first and last characters match one of the victim's real
 * counterparties, so the fake sits next to the real one in the victim's
 * history and gets copied by mistake. The tell is two different counterparties
 * of the same wallet that share their first four and last four characters.
 *
 * This is a heuristic. Vanity addresses and chance matches trip it too, which
 * is why responses call it a resemblance rather than a verdict, and name both
 * addresses so the model can compare their amounts and timing.
 *
 * @module backend/modules/blockchain/chain-query/lookalikes
 */

/** Characters compared at each end. Four at the start includes the leading `T`. */
const EDGE_CHARACTERS = 4;

/**
 * The ClickHouse expression grouping addresses by their first and last
 * characters, for use inside a query over one wallet's counterparties.
 *
 * @param column - The column holding the counterparty address. Always a
 *                 constant in the calling code, never caller input.
 * @returns The SQL expression.
 */
export function lookalikePatternSql(column: string): string {
    return `concat(substring(${column}, 1, ${EDGE_CHARACTERS}), right(${column}, ${EDGE_CHARACTERS}))`;
}

/**
 * The other addresses in a lookalike group, leaving out the address itself.
 *
 * @param self - The counterparty the group was found for.
 * @param group - Every counterparty sharing its pattern, including itself.
 * @returns The addresses it resembles; empty when it resembles none.
 */
export function otherLookalikes(self: string, group: readonly string[] | undefined): string[] {
    return (group ?? []).filter(address => address !== self).sort();
}

/** The note a response carries when it flags a resemblance. */
export const LOOKALIKE_NOTE =
    'resemblesCounterparties lists other counterparties of the same wallet sharing the first 4 and last 4 characters. That is the pattern address poisoning uses (a lookalike address sends a zero-value or tiny transfer so it appears in the victim\'s history). It is a heuristic, not proof; compare the amounts and timing of both addresses before concluding.';
