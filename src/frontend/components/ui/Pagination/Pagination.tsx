'use client';

import { useMemo } from 'react';
import type { IPaginationProps } from '@/types';
import { cn } from '../../../lib/cn';
import styles from './Pagination.module.scss';

/** Consecutive numbers from start to end (inclusive), for pagination page sequences. */
function range(start: number, end: number) {
    return Array.from({ length: end - start + 1 }).map((_, index) => start + index);
}

const DOTS = '…';

/**
 * Pagination Component
 *
 * A pagination control that displays page numbers, navigation arrows, and ellipsis
 * indicators for collapsed page ranges. Automatically calculates which pages to show
 * based on current position, total pages, and sibling count configuration.
 *
 * The component intelligently collapses page ranges with ellipsis when there are many
 * pages, always showing the first and last page while displaying a window of pages
 * around the current page. Navigation is bounded to valid page numbers.
 *
 * Returns null when pagination is unnecessary (total items fit on one page), making
 * it safe to always render without conditional logic.
 *
 * The frame around the buttons follows the page density. A public page draws
 * them in a muted, bordered bar; a compact admin page draws no frame, so the
 * control is no taller than the other controls in a table footer. The choice
 * is made by the `--pagination-*` tokens in `semantic-tokens.scss`, so the
 * component takes no prop for it.
 *
 * Plugins receive it as `context.ui.Pagination`. Its props are declared once
 * as `IPaginationProps` in the types package, which this component imports.
 *
 * @example
 * ```tsx
 * <Pagination
 *   total={150}
 *   pageSize={10}
 *   currentPage={5}
 *   siblingCount={1}
 *   onPageChange={setPage}
 * />
 * ```
 *
 * @param props - Pagination configuration and callbacks
 * @returns Pagination controls or null if unnecessary
 */
export function Pagination({ total, pageSize, currentPage, siblingCount = 1, onPageChange, className }: IPaginationProps) {
    /**
     * Calculates the optimal pagination range to display.
     *
     * Returns an array representing page numbers and ellipsis indicators. The algorithm
     * considers three cases:
     * 1. All pages fit without ellipsis
     * 2. Show left pages + ellipsis + last page
     * 3. Show first page + ellipsis + right pages
     * 4. Show first + ellipsis + middle + ellipsis + last
     *
     * Memoized to prevent unnecessary recalculations on unrelated prop changes.
     */
    const paginationRange = useMemo(() => {
        const totalPageCount = Math.max(1, Math.ceil(total / pageSize));
        const totalPageNumbers = siblingCount * 2 + 5;

        if (totalPageNumbers >= totalPageCount) {
            return range(1, totalPageCount);
        }

        const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
        const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPageCount);

        const showLeftDots = leftSiblingIndex > 2;
        const showRightDots = rightSiblingIndex < totalPageCount - 1;

        const firstPageIndex = 1;
        const lastPageIndex = totalPageCount;

        if (!showLeftDots && showRightDots) {
            const leftItemCount = 3 + 2 * siblingCount;
            const leftRange = range(1, leftItemCount);
            return [...leftRange, DOTS, totalPageCount];
        }

        if (showLeftDots && !showRightDots) {
            const rightItemCount = 3 + 2 * siblingCount;
            const rightRange = range(totalPageCount - rightItemCount + 1, totalPageCount);
            return [firstPageIndex, DOTS, ...rightRange];
        }

        return [firstPageIndex, DOTS, ...range(leftSiblingIndex, rightSiblingIndex), DOTS, lastPageIndex];
    }, [currentPage, pageSize, siblingCount, total]);

    if (total <= pageSize) {
        return null;
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    /**
     * Handles page change requests with bounds checking.
     *
     * Ensures the requested page is within valid range (1 to totalPages) and only
     * invokes the callback if the page actually changes, preventing unnecessary updates.
     *
     * @param page - Requested page number (may be out of bounds)
     */
    const handlePageChange = (page: number) => {
        const nextPage = Math.max(1, Math.min(page, totalPages));
        if (nextPage !== currentPage) {
            onPageChange(nextPage);
        }
    };

    return (
        <nav className={cn(styles.pagination, className)} aria-label="Pagination">
            <button
                type="button"
                className={styles.control}
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="Previous page"
            >
                ‹
            </button>
            {paginationRange.map((item, index) => {
                if (item === DOTS) {
                    return (
                        <span key={`dots-${index}`} className={styles.dots}>
                            {DOTS}
                        </span>
                    );
                }

                const pageNumber = item as number;
                const isActive = pageNumber === currentPage;
                return (
                    <button
                        key={`page-${pageNumber}`}
                        type="button"
                        className={cn(styles.page, isActive && styles['page--active'])}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => handlePageChange(pageNumber)}
                    >
                        {pageNumber}
                    </button>
                );
            })}
            <button
                type="button"
                className={styles.control}
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                aria-label="Next page"
            >
                ›
            </button>
        </nav>
    );
}
