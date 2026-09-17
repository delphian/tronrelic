/**
 * @fileoverview How each rung-level qualification is worded for the reader.
 */

import { AlertTriangle, Cpu, Info, type LucideIcon } from 'lucide-react';
import type { OriginHopCaveat } from '../../../types';

/**
 * Display text and styling for one caveat code.
 */
export interface ICaveatCopy {
    /** Short chip label shown on the rung. */
    label: string;

    /**
     * Badge tone. `warning` where the rung may actively mislead, `neutral` where
     * it is a detail worth knowing but does not weaken the attribution.
     */
    tone: 'warning' | 'neutral';

    /** Small leading glyph, decorative — the label already names the caveat. */
    icon: LucideIcon;

    /** The sentence behind the chip, revealed on hover or tap. */
    explanation: string;
}

/**
 * Caveat chip label, tone and explanation, keyed by the code the stream sends.
 *
 * Why the full sentence lives here rather than in a help page: the reason a rung
 * is weak has to be readable at the rung, at the moment someone is about to draw
 * a conclusion from it. A ladder of identical-looking rows invites the reader to
 * treat "a person sent this account 1 TRX" and "some contract's balance paid for
 * it and we followed whoever signed the call" as the same finding, and they are
 * not.
 */
export const CAVEAT_COPY: Record<OriginHopCaveat, ICaveatCopy> = {
    'internal-transfer': {
        label: 'Via contract',
        tone: 'neutral',
        icon: Cpu,
        explanation: 'The activating TRX came out of a contract\'s balance. A contract is code — it cannot own this account, and it may have been passing on value that arrived from someone else in the same transaction.'
    },
    'climbed-caller': {
        label: 'Signer followed',
        tone: 'neutral',
        icon: Info,
        explanation: 'This rung is the account that signed the contract call, not the contract the value came from. The signer paid for the execution, which is not the same as funding the account — it may be a service or a relayer acting for someone else.'
    },
    'caller-unresolved': {
        label: 'Signer unknown',
        tone: 'warning',
        icon: AlertTriangle,
        explanation: 'The signing account could not be read, so the ladder continues from the contract itself. Anything above this rung describes that contract\'s own history rather than this account\'s.'
    },
    'creation-time-unverified': {
        label: 'Timing unverified',
        tone: 'warning',
        icon: AlertTriangle,
        explanation: 'This account carries no on-chain creation time, so the attribution rests on the transaction type alone. That is weaker than a match confirmed against the account\'s own record.'
    }
};
