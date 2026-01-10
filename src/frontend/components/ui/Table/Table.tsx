'use client';

import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Table.module.scss';

/**
 * Table variant options for different visual styles.
 */
type TableVariant = 'default' | 'compact';

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
export function Table({ variant = 'default', className, children, ...props }: TableProps) {
    return (
        <div className={styles.table_wrapper}>
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
}

/**
 * Th Component
 *
 * Table header cell with consistent typography and optional width control.
 *
 * @param props - Table header cell properties
 * @returns A styled th element
 */
export function Th({ width, className, children, ...props }: ThProps) {
    return (
        <th
            className={cn(
                styles.th,
                width === 'shrink' && styles.th_shrink,
                width === 'expand' && styles.th_expand,
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
}

/**
 * Td Component
 *
 * Table data cell with consistent padding and optional muted text.
 *
 * @param props - Table data cell properties
 * @returns A styled td element
 */
export function Td({ muted, className, children, ...props }: TdProps) {
    return (
        <td
            className={cn(
                styles.td,
                muted && styles.td_muted,
                className
            )}
            {...props}
        >
            {children}
        </td>
    );
}
