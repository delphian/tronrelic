/**
 * @fileoverview Sort state for a storage browser's inventory table.
 *
 * Both browsers sort the same way, and the stacked-row sort picker in the
 * shared `Table` depends on that rule: it flips the direction by passing the
 * active column back to the handler. One hook keeps the two browsers from
 * drifting into two slightly different rules.
 */

import { useCallback, useState } from 'react';
import type { IInventoryColumn } from '../types/IInventoryColumn';
import type { IInventorySort } from '../types/IInventorySort';

/**
 * Work out the sort that follows a click on a column.
 *
 * Choosing the active column flips its direction. Choosing another column
 * switches to it in that column's own opening direction, so a first click on a
 * size column shows the largest first.
 *
 * @param previous - The sort before the click.
 * @param key - The column the operator chose.
 * @param columns - The browser's columns, read for the chosen column's opening direction.
 * @returns The sort to apply.
 */
function nextSort<TKey extends string>(
    previous: IInventorySort<TKey>,
    key: TKey,
    columns: ReadonlyArray<IInventoryColumn<TKey>>
): IInventorySort<TKey> {
    let next: IInventorySort<TKey>;
    if (previous.key === key) {
        next = { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' };
    } else {
        const column = columns.find((candidate) => candidate.key === key);
        next = { key, direction: column?.initialDirection ?? 'desc' };
    }
    return next;
}

/**
 * Hold a browser's inventory sort and the handler its header row and sort
 * picker share.
 *
 * Row expansion in both browsers is keyed by name rather than by position, so
 * an open collection or table stays open when the operator re-sorts.
 *
 * @param columns - The browser's sortable columns. Pass a module-level
 * constant, because the handler is rebuilt whenever this array changes.
 * @param initialSort - Where the inventory rests before the operator sorts it.
 * @returns The active sort, and the handler to pass to the header buttons and
 * the stacked-row sort picker.
 */
export function useInventorySort<TKey extends string>(
    columns: ReadonlyArray<IInventoryColumn<TKey>>,
    initialSort: IInventorySort<TKey>
): { sort: IInventorySort<TKey>; toggleSort: (key: TKey) => void } {
    const [sort, setSort] = useState<IInventorySort<TKey>>(initialSort);

    /**
     * Sort by a column, or flip the direction if it is already the sorted one.
     *
     * @param key - The column the operator chose.
     */
    const toggleSort = useCallback((key: TKey) => {
        setSort((previous) => nextSort(previous, key, columns));
    }, [columns]);

    return { sort, toggleSort };
}
