/**
 * @fileoverview What each rung's role chip means, and the sentence behind it.
 */

/**
 * The part an account played in the activation its rung describes.
 *
 * Three roles rather than one because a single activation can name two parties,
 * and which one the climb followed changes what the rung is evidence of.
 */
export type HopRole = 'funder' | 'signer' | 'contract';

/**
 * Display text for one role.
 */
export interface IHopRoleCopy {
    /** Short chip label shown on the rung. */
    label: string;

    /** The sentence behind the chip, revealed on hover or tap. */
    explanation: string;
}

/**
 * Role chip label and explanation, keyed by role.
 *
 * Why the full sentence lives beside the label: the three roles are different
 * claims about the same kind of event, and a one-word chip cannot carry that on
 * its own. Each sentence says what the account did and — for the two contract
 * cases — what it did not do, so a reader does not quietly promote "paid for the
 * execution" into "owns this wallet".
 */
export const ROLE_COPY: Record<HopRole, IHopRoleCopy> = {
    funder: {
        label: 'Funder',
        explanation: 'This account signed the transaction that brought the account below into existence and paid its creation fee.'
    },
    signer: {
        label: 'Signer',
        explanation: 'This account signed the contract call whose execution created the account below. It paid for that execution, which is not the same as funding the account — the value itself came out of the contract shown beside it.'
    },
    contract: {
        label: 'Contract',
        explanation: 'This is the contract whose balance created the account below. A contract is code and owns nothing, and the account that signed the call could not be read — so this rung names a mechanism, not a party.'
    }
};
