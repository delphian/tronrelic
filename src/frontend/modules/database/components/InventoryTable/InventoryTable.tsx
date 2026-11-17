'use client';

/**
 * @fileoverview The inventory table both storage browsers draw: one row per
 * collection or table, sortable by column, with the figures moving onto each
 * entry's heading line when the rows stack on a phone.
 *
 * The MongoDB and ClickHouse browsers used to build this table separately and
 * drifted apart. This component owns the parts that must stay the same in
 * both:
 * - the `Table` settings: compact rows, run out to the edges of the browser's
 *   panel, and stacked below the `mobile` width,
 * - the sortable header row,
 * - the stacked-row sort picker, offered only from three rows, because sorting
 *   one or two entries changes nothing an operator needs,
 * - the stacked heading-line summary, whose container query in
 *   `InventoryTable.module.scss` has to use the same width as `stackAt` here.
 */

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Table, Thead, Tbody, Tr, Th } from '../../../../components/ui/Table';
import type { IInventoryColumn } from '../../types/IInventoryColumn';
import type { IInventorySort } from '../../types/IInventorySort';
import styles from './InventoryTable.module.scss';

/**
 * The fewest rows for which the stacked layout offers its sort picker. Below
 * this the picker is a row of controls that cannot change anything useful.
 */
const STACKED_SORT_MIN_ROWS = 3;

/**
 * Props for the inventory table.
 */
interface IInventoryTableProps<TKey extends string> {
    /** The sortable columns, in display order; the first holds each row's expand control and name. */
    columns: ReadonlyArray<IInventoryColumn<TKey>>;

    /** The active sort, shown on the header buttons and in the sort picker. */
    sort: IInventorySort<TKey>;

    /**
     * The handler the header buttons and the sort picker share. It must flip
     * the direction when given the active column, which `useInventorySort`
     * does.
     */
    onSort(key: TKey): void;

    /** How many rows the table holds, which decides whether the sort picker is offered. */
    rowCount: number;

    /** The rows, normally one `InventoryRow` per collection or table. */
    children: ReactNode;
}

/**
 * Render the inventory table with its sortable header.
 *
 * The table is `flush` because it is the last thing in the browser's panel and
 * fills its width, so the panel's card draws the only boundary.
 *
 * @param props - Columns, sort state and handler, row count, and rows.
 * @returns The table.
 */
export function InventoryTable<TKey extends string>({
    columns,
    sort,
    onSort,
    rowCount,
    children
}: IInventoryTableProps<TKey>) {
    const stackedSort = rowCount >= STACKED_SORT_MIN_ROWS
        ? { columns, active: sort.key, direction: sort.direction, onSort }
        : undefined;

    return (
        <Table variant="compact" stackAt="mobile" flush stackedSort={stackedSort}>
            <Thead>
                <Tr>
                    {/* No column of its own for the expand control: it sits in
                      * the name cell, so a stacked row keeps it beside the name. */}
                    {columns.map((column) => {
                        const isSorted = sort.key === column.key;
                        const ascending = sort.direction === 'asc';
                        return (
                            <Th
                                key={column.key}
                                width={column.numeric ? 'shrink' : 'expand'}
                                numeric={column.numeric}
                                aria-sort={isSorted ? (ascending ? 'ascending' : 'descending') : 'none'}
                            >
                                <button
                                    type="button"
                                    className={styles.sort_button}
                                    onClick={() => onSort(column.key)}
                                >
                                    {column.label}
                                    {isSorted && ascending && <ArrowUp size={14} aria-hidden="true" />}
                                    {isSorted && !ascending && <ArrowDown size={14} aria-hidden="true" />}
                                    {!isSorted && (
                                        <ArrowUpDown size={14} aria-hidden="true" className={styles.sort_icon_idle} />
                                    )}
                                </button>
                            </Th>
                        );
                    })}
                </Tr>
            </Thead>
            <Tbody>{children}</Tbody>
        </Table>
    );
}
