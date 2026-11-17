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
 * after the header row is hidden. An entry lays its labelled values side by
 * side, as many to a line as fit, so it stays short on a tablet; a `Td` with a
 * long value asks for more of the line through `stackSpan`. A `Tr` given an
 * `onClick` also answers the keyboard, so a row that opens or expands
 * something is not a mouse-only control.
 */

import type { HTMLAttributes, KeyboardEvent, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
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
     * Pin the header row while the body scrolls. Puts the table in a scroll
     * box bounded to `--table-sticky-max-height` (70vh by default) so the
     * header stays visible on long tables. While the rows are stacked (see
     * `stackAt`) the header is hidden and the box lets go, so the entries
     * scroll with the page rather than inside the box.
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
     * rows are stacked. Labelled cells sit side by side in equal columns, as
     * many as fit, and one to a line at phone width. A cell with no label is
     * not given a column: the ones that open the row share its first line,
     * which suits the cell that identifies the row, and the ones that close it
     * go to the end of the last line, which suits a cell holding row actions.
     * Leave the prop off for a table that reads correctly at every width.
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
 * scrollable container for horizontal overflow handling, and a sticky table in
 * a bounded inner scroll box as well.
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
    const table = (
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
    );

    // A sticky header needs a bounded scroll box to stick to. The box is an
    // inner element rather than the wrapper, because the wrapper is the size
    // container the stacked-row rules query, and those rules can release only
    // what is inside it.
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
            {stickyHeader ? <div className={styles.table_scroll}>{table}</div> : table}
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
     * Marks the row as open, which gives it the muted background: set it on a
     * details row, or on a clickable row whose details are showing.
     *
     * On a row with `onClick`, it also tells assistive technology what the
     * click does. `true` or `false` marks the row as a toggle for details it
     * shows or hides, and renders `aria-expanded`. Leaving it unset marks a
     * row whose click does something else, such as opening a side panel, and
     * renders no `aria-expanded`.
     */
    isExpanded?: boolean;
}

/**
 * Tr Component
 *
 * Table row with hover states and optional error/expanded styling.
 *
 * A row given an `onClick` becomes a keyboard control as well, because a
 * clickable row is otherwise reachable only by mouse. It joins the tab order,
 * Enter or Space on the focused row runs the click, it draws a focus ring, and
 * `isExpanded` becomes `aria-expanded`. The row keeps its native row role:
 * `role="button"` would make every cell inside it presentational and cut the
 * cells off from their column headers. A row whose cells already hold a
 * button that does the same thing passes `tabIndex={-1}`, so the keyboard
 * reaches that action once rather than twice. A `tabIndex`, `onKeyDown`, or
 * `aria-expanded` the caller passes takes precedence.
 *
 * @param props - Table row properties including error and expanded states
 * @returns A styled tr element
 */
export function Tr({ hasError, isExpanded, className, children, onClick, onKeyDown, tabIndex, ...props }: TrProps) {
    const isClickable = onClick !== undefined;

    /**
     * Run a clickable row's click from the keyboard, as a native button does.
     *
     * Only a key pressed while the row itself has focus counts. A key pressed
     * in a control inside the row also bubbles here, and acting on it would
     * run the row's click on top of that control's own action. The click is
     * dispatched on the row so `onClick` receives a real click event.
     *
     * @param event - The key press, which runs the caller's own `onKeyDown`
     * first so a caller that handles the key itself can cancel this one.
     */
    const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>): void => {
        onKeyDown?.(event);
        const isActivationKey = event.key === 'Enter' || event.key === ' ';
        if (isActivationKey && !event.defaultPrevented && !event.repeat && event.target === event.currentTarget) {
            event.preventDefault();
            event.currentTarget.click();
        }
    };

    return (
        <tr
            className={cn(
                styles.tr,
                isClickable && styles.tr_clickable,
                hasError && styles.tr_error,
                isExpanded && styles.tr_expanded,
                className
            )}
            onClick={onClick}
            onKeyDown={isClickable ? handleKeyDown : onKeyDown}
            tabIndex={isClickable ? (tabIndex ?? 0) : tabIndex}
            aria-expanded={isClickable ? isExpanded : undefined}
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
     * Column width variant. `shrink` sizes the column to its widest value on
     * one line and gives the spare width to the other columns, for short
     * values such as dates, status badges, and a row's action buttons. The
     * column's body cells are kept on one line too, including content that
     * would wrap by layout, such as a wrapping row of buttons, so leave
     * `shrink` off a column whose text should wrap. `expand` makes the column
     * take the remaining space. While rows are stacked, every field wraps
     * whatever its column's width.
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
     * The column name shown with this cell's value while the table's rows
     * are stacked (see `stackAt` on `Table`). Ignored at full width, where the
     * header row already names the column. Omit it for a cell that should span
     * the whole stacked entry, such as the row's identifying value or its
     * action buttons.
     */
    label?: string;
    /**
     * How much of a stacked entry's line this field takes when fields sit side
     * by side. Set `'full'` for free text such as an error message, a query,
     * or a browser identifier, which otherwise wraps into a tall, narrow block.
     * Set `2` for a value such as a path that would wrap to three or more
     * lines in one column. Leave it off for short values, and for a value that
     * only wraps to two lines: a wider field can push the entry's last field
     * onto a line of its own, which costs more height than the wrap did. Needs
     * `label`, and has no effect at full width. At phone width, where every
     * field already has a line of its own, it puts the column name above the
     * value so the value gets the whole line instead of what is left beside
     * the name.
     */
    stackSpan?: 2 | 'full';
}

/**
 * Td Component
 *
 * Table data cell with consistent padding and optional muted text. The `label`
 * is written to `data-label`, which the stacked layout reads to draw the
 * column name with the value, and `stackSpan` is written to `data-stack-span`,
 * which the stacked layout reads to size the field.
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
export function Td({ muted, numeric, label, stackSpan, className, children, ...props }: TdProps) {
    return (
        <td
            className={cn(
                styles.td,
                muted && styles.td_muted,
                numeric && styles.cell_numeric,
                className
            )}
            data-label={label}
            data-stack-span={stackSpan}
            {...props}
        >
            {label ? <div className={styles.td_value}>{children}</div> : children}
        </td>
    );
}
