'use client';

/**
 * @fileoverview The sort picker a stacked `Table` shows in place of its hidden
 * column headers.
 *
 * When a table stacks its rows (`stackAt`), the header row is hidden, and with
 * it every sort button a header carried. A table that passes `stackedSort` gets
 * this picker instead: a column select and a direction toggle, rendered inside
 * the table's own wrapper so the same container query that stacks the rows
 * shows the picker. The two can therefore never disagree about whether the
 * table is stacked. At full width the picker is hidden and the headers sort.
 */

import { useId } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Select } from '../Select';
import { IconButton } from '../IconButton';
import styles from './Table.module.scss';

/**
 * Sort state and handler a table shares with its stacked-row picker.
 *
 * `onSort` must follow the same rule the column headers use: passing the
 * active column flips the direction, and passing another column switches to it
 * in that column's natural direction. The picker relies on that rule to flip
 * the direction by passing the active column.
 */
export interface ITableStackedSort<TKey extends string = string> {
    /** Every sortable column, in table order, with the name its header shows. */
    columns: ReadonlyArray<{ key: TKey; label: string }>;

    /** The column the rows are currently sorted by. */
    active: TKey;

    /** The current sort direction. */
    direction: 'asc' | 'desc';

    /**
     * The table's sort handler, shared with its headers. Declared as a method
     * so a caller whose handler takes a narrower key type can pass it.
     */
    onSort(key: TKey): void;
}

/**
 * Render the column picker and direction toggle.
 *
 * @param props - The sortable columns, the current sort, and the handler.
 * @returns The picker row; the table stylesheet shows it only while stacked.
 */
export function TableStackedSort({ columns, active, direction, onSort }: ITableStackedSort) {
    const selectId = useId();
    const ascending = direction === 'asc';
    return (
        <div className={styles.stacked_sort}>
            <label htmlFor={selectId} className={styles.stacked_sort_label}>Sort by</label>
            <Select
                id={selectId}
                size="sm"
                value={active}
                onChange={event => onSort(event.target.value)}
                className={styles.stacked_sort_select}
            >
                {columns.map(column => (
                    <option key={column.key} value={column.key}>{column.label}</option>
                ))}
            </Select>
            <IconButton
                size="sm"
                onClick={() => onSort(active)}
                aria-label={ascending ? 'Sorted ascending; switch to descending' : 'Sorted descending; switch to ascending'}
            >
                {ascending ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
            </IconButton>
        </div>
    );
}
