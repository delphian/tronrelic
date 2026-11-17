'use client';

/**
 * @fileoverview The page bar above a collection's documents or a table's rows
 * in the storage browsers.
 *
 * The core `Pagination` primitive is not used here because it offers a button
 * for every nearby page number, and the MongoDB browser cannot go to an
 * arbitrary page: it pages by cursor (see `CollectionBrowser`), so it can only
 * step forward or back or jump to either end. Both browsers share this bar so
 * their pagers look and behave the same.
 *
 * The four controls are icon buttons, which keeps the pager on one line on a
 * phone. Text-labelled Previous and Next buttons wrapped it onto two.
 */

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import styles from './BrowserPager.module.scss';

/**
 * Props for the page bar.
 */
interface IBrowserPagerProps {
    /** What the pages hold, such as "64 documents", shown at the start of the bar. */
    summary: ReactNode;

    /** The page on screen, counted from 1. */
    page: number;

    /** The page count shown beside the current page. */
    totalPages: number;

    /** Whether the first-page control is enabled. */
    canFirst: boolean;

    /** Whether the previous-page control is enabled. */
    canPrevious: boolean;

    /** Whether the next-page control is enabled. */
    canNext: boolean;

    /** Whether the last-page control is enabled. */
    canLast: boolean;

    /** Load the first page. */
    onFirst(): void;

    /** Load the page before the current one. */
    onPrevious(): void;

    /** Load the page after the current one. */
    onNext(): void;

    /** Load the last page. */
    onLast(): void;
}

/**
 * Render the summary and the page controls.
 *
 * The buttons pass no `size`, so they take the default step of the page's
 * density, which is the compact step on every admin page.
 *
 * @param props - Summary text, position, which controls are enabled, and their handlers.
 * @returns The page bar.
 */
export function BrowserPager({
    summary,
    page,
    totalPages,
    canFirst,
    canPrevious,
    canNext,
    canLast,
    onFirst,
    onPrevious,
    onNext,
    onLast
}: IBrowserPagerProps) {
    return (
        <div className={styles.bar}>
            <span className={styles.summary}>{summary}</span>
            <nav className={styles.controls} aria-label="Pages">
                <Button
                    variant="ghost"
                    icon={<ChevronsLeft size={16} />}
                    aria-label="First page"
                    disabled={!canFirst}
                    onClick={onFirst}
                />
                <Button
                    variant="ghost"
                    icon={<ChevronLeft size={16} />}
                    aria-label="Previous page"
                    disabled={!canPrevious}
                    onClick={onPrevious}
                />
                <span className={styles.position}>
                    Page {page.toLocaleString()} of {totalPages.toLocaleString()}
                </span>
                <Button
                    variant="ghost"
                    icon={<ChevronRight size={16} />}
                    aria-label="Next page"
                    disabled={!canNext}
                    onClick={onNext}
                />
                <Button
                    variant="ghost"
                    icon={<ChevronsRight size={16} />}
                    aria-label="Last page"
                    disabled={!canLast}
                    onClick={onLast}
                />
            </nav>
        </div>
    );
}
