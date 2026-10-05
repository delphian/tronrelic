/**
 * AboutDetails Component
 *
 * A collapsed explanation of how a section's figures are built, opened on
 * request.
 *
 * Several traffic tabs led with a full paragraph of methodology above their
 * data, which an operator reads once and then scrolls past on every visit
 * after that. The explanation still matters — it is what stops a figure being
 * read as something it is not — so it stays on the page, folded into a native
 * `<details>` element. The browser supplies the keyboard and screen-reader
 * behaviour, and the closed state costs one line.
 */

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import styles from './AboutDetails.module.scss';

interface IAboutDetailsProps {
    /** The one-line summary the reader clicks to open the explanation. */
    summary: string;
    /** The explanation itself. */
    children: ReactNode;
    /** Layout the caller owns, such as a margin inside a particular panel. */
    className?: string;
}

/**
 * Render the explanation inside a collapsed disclosure.
 *
 * @param props - The summary line, the explanation, and an optional class name.
 * @returns The disclosure element.
 */
export function AboutDetails({ summary, children, className }: IAboutDetailsProps) {
    return (
        <details className={className ? `${styles.details} ${className}` : styles.details}>
            <summary className={styles.summary}>
                <Info size={14} aria-hidden="true" />
                {summary}
            </summary>
            <div className={styles.body}>{children}</div>
        </details>
    );
}
