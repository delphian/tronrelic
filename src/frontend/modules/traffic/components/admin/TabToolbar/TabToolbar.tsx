/**
 * TabToolbar Component
 *
 * The one-line header a traffic tab section opens with: a section title, a
 * short line of context, and the section's own controls, with an optional
 * collapsed explanation underneath.
 *
 * The Crawlers, SEO, and Redirects sections each opened with a large heading,
 * a multi-line paragraph, and a picker stacked beside them, which together
 * took a fifth of a laptop screen before any data appeared. This keeps the
 * same three facts on one row in the type scale a `Panel` header uses, and
 * moves the paragraph into an `AboutDetails` disclosure, so the data starts
 * one line below the tab row.
 */

import type { ReactNode } from 'react';
import { AboutDetails } from '../AboutDetails';
import styles from './TabToolbar.module.scss';

interface ITabToolbarProps {
    /** Section title, rendered as an `h2` under the page's tab row. */
    title: string;
    /** Short context shared by everything below, such as the data's freshness. */
    meta?: ReactNode;
    /** Controls that govern every panel in the section, such as a window picker. */
    actions?: ReactNode;
    /**
     * Methodology the reader may need once. Rendered collapsed under the row,
     * with `aboutSummary` as its one-line label.
     */
    about?: ReactNode;
    /** Label for the collapsed explanation. */
    aboutSummary?: string;
}

/**
 * Render the section's title row and optional collapsed explanation.
 *
 * @param props - Title, optional meta line, controls, and explanation.
 * @returns The toolbar header.
 */
export function TabToolbar({ title, meta, actions, about, aboutSummary = 'How these figures are built' }: ITabToolbarProps) {
    return (
        <header className={styles.toolbar}>
            <div className={styles.row}>
                <h2 className={styles.title}>{title}</h2>
                {meta && <div className={styles.meta}>{meta}</div>}
                {actions && <div className={styles.actions}>{actions}</div>}
            </div>
            {about && <AboutDetails summary={aboutSummary}>{about}</AboutDetails>}
        </header>
    );
}
