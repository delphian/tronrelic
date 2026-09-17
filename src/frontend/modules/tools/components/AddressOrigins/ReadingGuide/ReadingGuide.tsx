/**
 * @fileoverview The standing guide to what an activation chain does and does not
 * show.
 */

'use client';

import { useId } from 'react';
import { BookOpen } from 'lucide-react';
import styles from './ReadingGuide.module.scss';

/**
 * One thing a reader has to know before drawing a conclusion from a chain.
 */
interface IGuidePoint {
    /** The claim being corrected, stated as a short sentence. */
    heading: string;

    /** Why it is wrong, and what the chain actually supports. */
    body: string;
}

/**
 * The five readings this tool is most often misused to support.
 *
 * Each entry names a conclusion someone is about to draw and says what the data
 * actually supports instead. They are written as corrections rather than as
 * neutral definitions because that is the shape of the mistake: nobody misreads
 * a chain through not knowing what activation is, they misread it by treating a
 * fee payment as ownership.
 */
const GUIDE_POINTS: IGuidePoint[] = [
    {
        heading: 'Activation is a payment, not ownership.',
        body: 'It means that account paid the roughly 1 TRX fee to bring this address into existence. Paid-activation services do this for strangers, and an exchange does it for every withdrawal to a new address.'
    },
    {
        heading: 'A shared account is only as meaningful as it is rare.',
        body: 'Exchanges, faucets, wallet-onboarding flows and airdrop contracts have each activated millions of unrelated addresses. This tool does not yet measure how many accounts an ancestor created, so treat a shared account as a lead to check.'
    },
    {
        heading: 'The rungs are not all the same kind of claim.',
        body: 'Some name the account that signed a transfer. Some name a contract, which is code and owns nothing. Some name whoever signed a call to that contract. Each rung says which it is.'
    },
    {
        heading: 'A chain that ends has run out of indexed history.',
        body: 'That is not the same as reaching a true origin, and the closing line on each chain says which one happened.'
    },
    {
        heading: 'One address is not always one actor.',
        body: 'An account can be controlled by keys held elsewhere. Where that is visible, the other controllers are offered as leads beneath the rung.'
    }
];

/**
 * The reading guide.
 *
 * It is always on screen rather than behind a disclosure, because the
 * conclusions it warns against are the ones a reader forms while the chains are
 * still filling in — a guide they have to open first is a guide they open after
 * they have already decided. It sits in the rail beside the results so it stays
 * in view while a long chain is scrolled.
 *
 * @returns The rendered guide.
 */
export function ReadingGuide() {
    const titleId = useId();

    return (
        <section className={styles.guide} aria-labelledby={titleId}>
            <h2 id={titleId} className={styles.title}>
                <BookOpen size={16} aria-hidden="true" />
                How to read a chain
            </h2>

            <dl className={styles.points}>
                {GUIDE_POINTS.map(point => (
                    <div key={point.heading} className={styles.point}>
                        <dt className={styles.point_heading}>{point.heading}</dt>
                        <dd className={styles.point_body}>{point.body}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
