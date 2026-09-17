/**
 * @fileoverview The accounts more than one of the current traces reached.
 */

'use client';

import { useId } from 'react';
import { Users } from 'lucide-react';
import { TronAddress } from '../../../../../components/ui/TronAddress';
import type { ISharedParty } from '../lib/collectSharedParties';
import styles from './CommonGround.module.scss';

/**
 * Props for {@link CommonGround}.
 */
export interface ICommonGroundProps {
    /** The shared accounts, most widely shared first. */
    parties: ISharedParty[];

    /** How many wallets the current trace covered, for the "n of m" reading. */
    walletCount: number;

    /** Start a new trace from a shared account. */
    onFollow: (address: string) => void;
}

/**
 * The convergence panel.
 *
 * Why this exists as a panel rather than only as a highlight on the ladders: the
 * multi-wallet mode answers one question — what do these wallets have in common
 * — and the previous design made the reader find the answer by scanning ten
 * chains for a tinted row. Stating it directly is the whole point of comparing
 * wallets, so it goes at the top of the results rather than being left implicit.
 *
 * The steps are listed per wallet because a parent shared by two wallets and a
 * distant ancestor they happen to have in common are very different findings,
 * and a count on its own cannot tell them apart.
 *
 * @param props - {@link ICommonGroundProps}.
 * @returns The panel, or null when nothing converged.
 */
export function CommonGround({ parties, walletCount, onFollow }: ICommonGroundProps) {
    const titleId = useId();

    return parties.length === 0 ? null : (
        <section className={styles.panel} aria-labelledby={titleId}>
            <header className={styles.header}>
                <h2 id={titleId} className={styles.title}>
                    <Users size={16} aria-hidden="true" />
                    Common ground
                </h2>
                <p className={styles.note}>
                    Reached by more than one of these wallets. A lead to check, not proof of a
                    shared operator — one exchange or onboarding service activates millions of
                    unrelated wallets.
                </p>
            </header>

            <ul className={styles.list}>
                {parties.map(party => (
                    <li key={party.address} className={styles.item}>
                        <TronAddress address={party.address} />
                        <p className={styles.reach}>
                            <span className={styles.count}>
                                {party.sightings.length} of {walletCount} wallets
                            </span>
                            <span className={styles.steps}>
                                {party.sightings
                                    .map(sighting => (sighting.step === 0 ? 'one of your wallets' : `${sighting.step} up`))
                                    .join(', ')}
                            </span>
                        </p>
                        <button type="button" className={styles.follow} onClick={() => onFollow(party.address)}>
                            Trace this account
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
