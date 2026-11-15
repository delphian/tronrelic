'use client';

/**
 * @fileoverview A column header on the Users tab table that sorts the account
 * list by its column when clicked.
 *
 * The header is a real `<button>` inside the `<th>`, so keyboard users can sort
 * too, and the `<th>` carries `aria-sort` so a screen reader announces which
 * column the table is ordered by and in which direction.
 */

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { AccountSortDirection, AccountSortField } from '@/types';
import { Th } from '../../../../../components/ui/Table';
import styles from './UsersMonitor.module.scss';

/** Props for one sortable header. */
interface ISortableHeaderProps {
    /** The column this header sorts by. */
    field: AccountSortField;

    /** The header's visible label. */
    label: string;

    /** The column the table is currently sorted by. */
    sortBy: AccountSortField;

    /** The current sort direction. */
    sortDirection: AccountSortDirection;

    /** Asks the table to sort by this header's column. */
    onSort: (field: AccountSortField) => void;
}

/**
 * Render a sortable `<th>`, showing an arrow for the active column.
 *
 * @param props - The column, its label, the current sort, and the sort callback.
 * @returns The header cell.
 */
export function SortableHeader({ field, label, sortBy, sortDirection, onSort }: ISortableHeaderProps) {
    const active = field === sortBy;
    const ariaSort = active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
    const Icon = !active ? ArrowUpDown : sortDirection === 'asc' ? ArrowUp : ArrowDown;
    return (
        <Th aria-sort={ariaSort}>
            <button
                type="button"
                className={active ? `${styles.sort_button} ${styles.sort_button__active}` : styles.sort_button}
                onClick={() => onSort(field)}
            >
                {label}
                <Icon size={14} aria-hidden="true" className={styles.sort_icon} />
            </button>
        </Th>
    );
}
