/**
 * @fileoverview The alternative accounts a reader can trace from one rung.
 */

'use client';

import { Cpu, Key } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../../../lib/cn';
import styles from './LeadList.module.scss';

/**
 * Props for {@link LeadList}.
 */
export interface ILeadListProps {
    /**
     * The contract whose balance funded the activation, when the climb followed
     * the signer instead. Absent on rungs where there was only one party.
     */
    contractParty?: string | null;

    /** Accounts that co-control the rung's own account. */
    controllers: string[];

    /**
     * Accounts named by more than one trace. A lead needs this because the
     * shared party of a hop is often the contract the climb stepped over rather
     * than the account it followed, and that account is rendered here and
     * nowhere else.
     */
    shared: Set<string>;

    /** Start a new trace from the chosen lead. */
    onFollow: (address: string) => void;

    /**
     * Extra class from the caller. The rung uses it to indent this row into the
     * same column as its other supporting rows, which it cannot do from its own
     * stylesheet because these class names are scoped to this module.
     */
    className?: string;
}

/**
 * Shorten an address enough to tell two leads on the same rung apart.
 *
 * A rung can offer several controllers, and a row of buttons all reading "Trace
 * the controller" is two identical visible labels and two identical accessible
 * names for two different actions. The tail is used because it is what a reader
 * comparing against an explorer tab scans for, and it matches the ending the
 * `<TronAddress>` chip on the rung above already shows.
 *
 * @param address - Full base58 address to shorten.
 * @returns The last four characters, prefixed with an ellipsis.
 */
function abbreviate(address: string): string {
    return `…${address.slice(-4)}`;
}

/**
 * One offer to trace something the climb did not follow.
 */
interface ILead {
    /** The account the reader would trace. */
    address: string;

    /** Button label, naming what kind of lead this is. */
    label: string;

    /** Why this lead is a different question from the rung it sits under. */
    hint: string;

    /** Leading glyph, decorative — the label carries the meaning. */
    icon: LucideIcon;
}

/**
 * The leads offered beneath a rung.
 *
 * Why offer them at all: each rung is one reading of a transaction that supports
 * several, and the climb has to pick one to continue from. Showing what it
 * passed over — the contract it did not walk into, the keys that can also act
 * for this account — lets the reader test the other reading instead of trusting
 * the single path the tool chose.
 *
 * A lead also says when another trace named the same account. Without it, two
 * wallets funded by one contract through different signers would show the
 * shared-account panel while nothing on either ladder was marked, because
 * neither ladder climbs through the contract they share.
 *
 * The hint is carried as visually hidden text inside the button rather than in a
 * `<Tooltip>`, because this trigger is itself the action: a tooltip that opens on
 * the same click that starts a new trace would be left hanging over results the
 * reader asked for.
 *
 * @param props - {@link ILeadListProps}.
 * @returns The leads row, or null when this rung has nothing further to offer.
 */
export function LeadList({ contractParty, controllers, shared, onFollow, className }: ILeadListProps) {
    const leads: ILead[] = [];

    if (contractParty) {
        leads.push({
            address: contractParty,
            label: `Trace the contract ${abbreviate(contractParty)}`,
            icon: Cpu,
            hint: 'Trace the contract whose balance funded this account. Its own ancestry leads to whoever deployed it, which is a different question from who funded this wallet.'
        });
    }

    // De-duplicated because an account record can list the same key under more
    // than one permission, which would otherwise render the same lead twice and
    // collide on the key below.
    for (const controller of new Set(controllers)) {
        leads.push({
            address: controller,
            label: `Trace the controller ${abbreviate(controller)}`,
            icon: Key,
            hint: 'This key can authorise transactions for the account on this rung. Its ancestry is a separate lead that the single ladder above does not cover.'
        });
    }

    return leads.length === 0 ? null : (
        <div className={cn(styles.leads, className)}>
            {leads.map(lead => (
                <button
                    key={lead.address}
                    type="button"
                    className={styles.lead}
                    onClick={() => onFollow(lead.address)}
                >
                    <lead.icon size={12} aria-hidden="true" />
                    {lead.label}
                    {shared.has(lead.address) && <span className={styles.lead_shared}>shared</span>}
                    <span className={styles.sr_only}>. {lead.hint}</span>
                </button>
            ))}
        </div>
    );
}
