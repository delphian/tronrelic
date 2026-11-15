'use client';

/**
 * @fileoverview The shared table primitives: `Table`, `Thead`, `Tbody`, `Tr`,
 * `Th`, and `Td`.
 *
 * Every data table on the site renders through these so that header type, cell
 * rhythm, row hover, flush placement inside a card, and narrow-width behaviour
 * are decided in one place. A table with more columns than a phone or tablet
 * can show opts into `stackAt`, which turns each row into a labelled entry once
 * the table's own container is at or below that width. Each `Td` carries its
 * column name through `label` so the entry can still say what each value is
 * after the header row is hidden.
 */

import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';
import { TableStackedSort, type ITableStackedSort } from './TableStackedSort';
import styles from './Table.module.scss';

/**
 * Table variant options for different visual styles.
 */
type TableVariant = 'default' | 'compact';

/**
 * The container width at or below which a table's rows stack into labelled
 * entries: `tablet` is 1024px, `mobile` is 768px, and `phone` is 480px, the
 * project breakpoints `$breakpoint-tablet`, `$breakpoint-mobile-lg`, and
 * `$breakpoint-mobile-md`. The width is measured against the table's own
 * wrapper rather than the window, so a table in a slide-over, modal, or
 * two-column band stacks for the space it really has.
 */
type TableStackAt = 'tablet' | 'mobile' | 'phone';

/**
 * TableProps interface defines properties for the Table component.
 *
 * Extends standard table attributes to support visual variants and
 * container query-based responsive behavior.
 */
interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
    /**
     * Visual style variant
     * @default 'default'
     */
    variant?: TableVariant;
    /**
     * Pin the header row while the body scrolls. Bounds the wrapper height and
     * makes it the scroll container so the header stays visible on long tables.
     * @default false
     */
    stickyHeader?: boolean;
    /**
     * Run the table out to the edges of the `<Card>` holding it, instead of
     * sitting inside the card's padding with a border of its own.
     *
     * Set this whenever the table is the last thing in a card and fills the
     * card's width. The card already draws the boundary, so the table drawing a
     * second one inside it stacks two borders a few pixels apart and spends
     * width the columns need — which is worst on a narrow screen, where that
     * doubled gutter is the difference between a column fitting and scrolling.
     *
     * Leave it off when something follows the table inside the same card, since
     * the variant pulls itself down onto the card's bottom edge.
     * @default false
     */
    flush?: boolean;
    /**
     * Stack each row into a labelled entry when the table's container is at or
     * below this width, instead of scrolling sideways.
     *
     * Choose `tablet` for a table whose columns do not fit in 1024px, and
     * `mobile` for one that fits a tablet but not a phone. Choose `phone` for a
     * table that sits in a narrow band, such as one of two side-by-side panels,
     * where `mobile` would already stack it on a desktop. Give every `Td` a
     * `label` naming its column, because the header row is hidden while the
     * rows are stacked. A cell with no label spans the whole entry, which suits
     * the cell that identifies the row and a cell holding row actions. Leave the
     * prop off for a table that reads correctly at every width.
     */
    stackAt?: TableStackAt;
    /**
     * Sorting to offer while the rows are stacked. Stacking hides the header
     * row and the sort buttons in it, so a sortable table passes its sort
     * state and handler here and gets a column picker and direction toggle
     * above the stacked rows instead. Hidden at full width, where the headers
     * sort. Has no effect without `stackAt`.
     */
    stackedSort?: ITableStackedSort;
}

/**
 * Table Component
 *
 * A styled table wrapper that provides consistent styling, responsive behavior
 * via container queries, and accessibility attributes. Wraps content in a
 * scrollable container for horizontal overflow handling.
 *
 * @example
 * ```tsx
 * <Table>
 *   <Thead>
 *     <Tr>
 *       <Th>Name</Th>
 *       <Th>Status</Th>
 *     </Tr>
 *   </Thead>
 *   <Tbody>
 *     <Tr>
 *       <Td>Item 1</Td>
 *       <Td>Active</Td>
 *     </Tr>
 *   </Tbody>
 * </Table>
 * ```
 *
 * @param props - Table component properties
 * @returns A styled table element with wrapper
 */
export function Table({ variant = 'default', stickyHeader = false, flush = false, stackAt, stackedSort, className, children, ...props }: TableProps) {
    return (
        <div
            className={cn(
                styles.table_wrapper,
                stickyHeader && styles.table_wrapper_sticky,
                flush && styles.table_wrapper_flush,
                stackAt === 'tablet' && styles.table_wrapper_stack_tablet,
                stackAt === 'mobile' && styles.table_wrapper_stack_mobile,
                stackAt === 'phone' && styles.table_wrapper_stack_phone
            )}
        >
            {stackAt && stackedSort && <TableStackedSort {...stackedSort} />}
            <table
                className={cn(
                    styles.table,
                    variant === 'compact' && styles.table_compact,
                    className
                )}
                {...props}
            >
                {children}
            </table>
        </div>
    );
}

/**
 * Thead Component
 *
 * Table header section with consistent styling for column headers.
 *
 * @param props - Standard thead HTML attributes
 * @returns A styled thead element
 */
export function Thead({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
    return (
        <thead className={cn(styles.thead, className)} {...props}>
            {children}
        </thead>
    );
}

/**
 * Tbody Component
 *
 * Table body section for data rows.
 *
 * @param props - Standard tbody HTML attributes
 * @returns A styled tbody element
 */
export function Tbody({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
    return (
        <tbody className={cn(styles.tbody, className)} {...props}>
            {children}
        </tbody>
    );
}

/**
 * TrProps interface for table row with additional features.
 */
interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
    /**
     * Whether this row has an error state
     * @default false
     */
    hasError?: boolean;
    /**
     * Whether this row is expandable (details row)
     * @default false
     */
    isExpanded?: boolean;
}

/**
 * Tr Component
 *
 * Table row with hover states and optional error/expanded styling.
 *
 * @param props - Table row properties including error and expanded states
 * @returns A styled tr element
 */
export function Tr({ hasError, isExpanded, className, children, ...props }: TrProps) {
    return (
        <tr
            className={cn(
                styles.tr,
                hasError && styles.tr_error,
                isExpanded && styles.tr_expanded,
                className
            )}
            {...props}
        >
            {children}
        </tr>
    );
}

/**
 * ThProps interface for table header cells.
 */
interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
    /**
     * Column width variant
     */
    width?: 'auto' | 'shrink' | 'expand';
    /**
     * Right-align the column and render it in tabular figures.
     *
     * Set on both the header and its cells for any quantity a reader
     * compares down the column: right alignment lines the values up on their
     * least significant digit, which is what makes the largest and smallest
     * findable at a glance, and tabular figures stop the column jittering as
     * digits change. Leave it off for text, identifiers, and dates.
     * @default false
     */
    numeric?: boolean;
}

/**
 * Th Component
 *
 * Table header cell with consistent typography and optional width control.
 *
 * @param props - Table header cell properties
 * @returns A styled th element
 */
export function Th({ width, numeric, className, children, ...props }: ThProps) {
    return (
        <th
            className={cn(
                styles.th,
                width === 'shrink' && styles.th_shrink,
                width === 'expand' && styles.th_expand,
                numeric && styles.cell_numeric,
                className
            )}
            {...props}
        >
            {children}
        </th>
    );
}

/**
 * TdProps interface for table data cells.
 */
interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
    /**
     * Whether cell content should be muted
     * @default false
     */
    muted?: boolean;
    /**
     * Right-align the cell and render it in tabular figures. Mirror the
     * `numeric` set on the column's `Th` — see that prop for why.
     * @default false
     */
    numeric?: boolean;
    /**
     * The column name shown beside this cell's value while the table's rows
     * are stacked (see `stackAt` on `Table`). Ignored at full width, where the
     * header row already names the column. Omit it for a cell that should span
     * the whole stacked entry, such as the row's identifying value or its
     * action buttons.
     */
    label?: string;
}

/**
 * Td Component
 *
 * Table data cell with consistent padding and optional muted text. The `label`
 * is written to `data-label`, which the stacked layout reads to draw the
 * column name beside the value.
 *
 * A labelled cell wraps its children in one value container. The stacked
 * layout puts the column name in the cell's first grid track and the value in
 * the second, and a grid gives every child a track of its own, so a cell that
 * passes two children, such as a figure and the limit beside it or a list of
 * entries, would send everything after the first back under the column name.
 * The container keeps the whole value in the value track however many children
 * the call site passes, including bare text, which no CSS selector can reach.
 * It generates no box at full width, so the cell's own layout is unchanged
 * there. It is a `div` because several labelled cells pass `div` children.
 *
 * @param props - Table data cell properties
 * @returns A styled td element
 */
export function Td({ muted, numeric, label, className, children, ...props }: TdProps) {
    return (
        <td
            className={cn(
                styles.td,
                muted && styles.td_muted,
                numeric && styles.cell_numeric,
                className
            )}
            data-label={label}
            {...props}
        >
            {label ? <div className={styles.td_value}>{children}</div> : children}
        </td>
    );
}
