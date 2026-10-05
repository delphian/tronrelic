/**
 * BarList Component
 *
 * A short ranked list drawn as label, bar, and figure on one line per row,
 * used for the conversion funnel and the device breakdown on the Analytics
 * tab.
 *
 * Both sections used to carry their own copy of this markup with a 16px-tall
 * bar and a label column held open by a fixed width, which made a three-row
 * list take the height of a small chart. The list is now one grid whose rows
 * share its columns through subgrid: the label column is as wide as the
 * longest label, every bar gets the same length, and the figures line up on
 * the right. Bars draw at the shared meter height.
 */

import type { ReactNode } from 'react';
import { ShareBar } from '../ShareBar';
import styles from './BarList.module.scss';

/**
 * One row of a bar list.
 */
export interface IBarListRow {
    /** Stable React key. */
    key: string;
    /** What the row measures. */
    label: ReactNode;
    /** The value the bar is drawn from. The largest row fills its bar. */
    value: number;
    /** The figure shown at the end of the row, already formatted. */
    figure: ReactNode;
}

interface IBarListProps {
    /** The rows, in display order. */
    rows: IBarListRow[];
    /** Accessible name for the list, since it has no visible heading of its own. */
    label: string;
}

/**
 * Render the rows as an aligned label, bar, and figure grid.
 *
 * @param props - The rows to draw and the list's accessible name.
 * @returns The list element.
 */
export function BarList({ rows, label }: IBarListProps) {
    const max = rows.reduce((peak, row) => Math.max(peak, row.value), 0);
    return (
        <ul className={styles.list} aria-label={label}>
            {rows.map(row => (
                <li key={row.key} className={styles.row}>
                    <span className={styles.label}>{row.label}</span>
                    <ShareBar value={row.value} max={max} fluid />
                    <span className={styles.figure}>{row.figure}</span>
                </li>
            ))}
        </ul>
    );
}
