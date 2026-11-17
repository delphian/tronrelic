/**
 * Published props contract for the `Pagination` page control exposed to
 * plugins on `context.ui.Pagination`.
 *
 * Declared here rather than beside the component so core and plugins share one
 * copy of the shape, and the component imports it instead of restating it.
 * See `ISkeletonProps` for why a second hand-written copy is avoided.
 */

/**
 * The `Pagination` surface published to plugins.
 *
 * The control draws previous and next buttons and a window of page numbers,
 * collapsing long runs into an ellipsis. It renders nothing when every item
 * fits on one page, so a caller can always render it. Its frame follows the
 * page density: a bordered bar on a public page and bare buttons on a compact
 * admin page, chosen by tokens rather than by a prop.
 */
export interface IPaginationProps {
    /** Number of items across all pages, which sets how many pages exist. */
    total: number;

    /** Number of items shown on each page. */
    pageSize: number;

    /** The page being shown, counted from 1. */
    currentPage: number;

    /**
     * How many page numbers to show on each side of the current page before
     * collapsing the rest into an ellipsis. Defaults to 1.
     */
    siblingCount?: number;

    /**
     * Called with the page the user picked. Only called with a page inside
     * the valid range and different from `currentPage`, so the caller can
     * fetch it without checking.
     */
    onPageChange: (page: number) => void;

    /** Extra class for layout the caller owns, such as aligning the control in a footer. */
    className?: string;
}
