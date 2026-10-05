/**
 * FigureList — a dense list of labelled figures, one figure per row.
 *
 * Boxed stat tiles work for a headline band of a few figures, but a section of
 * ten figures as tiles leaves orphans with empty space beside them, lets the
 * borders outweigh the numbers, and takes a full screen. A reader scanning many
 * figures reads a column of labels and a column of values, the way a statement
 * or a fact sheet is laid out, so that is what this renders: the label on the
 * left, the value right-aligned in tabular figures on the right, a hairline
 * between rows, and a note in small type under its label only when there is
 * one.
 *
 * The list flows into as many columns as its container has room for, so the
 * same component serves a narrow fact column and a wide section without the
 * caller choosing a column count.
 *
 * First built in the resource-markets plugin for its market detail page and
 * moved into core unchanged.
 *
 * @module components/ui/FigureList
 */

import type { IFigureListProps, IFigureListRow } from '@/types';
import { cn } from '../../../lib/cn';
import styles from './FigureList.module.scss';

/**
 * Maps a row's tone to the class that colours its value. A lookup rather than
 * a conditional chain so a tone added to the union without a colour behind it
 * fails the type check.
 */
const valueToneClass: Record<NonNullable<IFigureListRow['tone']>, string | undefined> = {
    default: undefined,
    success: styles.value__success,
    warning: styles.value__warning
};

/**
 * Render figures as label-and-value rows.
 *
 * @param props - Rows, optional accessible label, column mode, and class name,
 *        as described on `IFigureListProps`.
 * @returns The definition list, or null when there are no rows, so a caller
 *          can render it unconditionally.
 *
 * @example
 * ```tsx
 * <FigureList
 *     label="Key facts"
 *     rows={[
 *         { key: 'latency', label: 'Median delivery', value: '4.2', unit: 's' },
 *         { key: 'served', label: 'Orders served', value: '98.1%', tone: 'success' }
 *     ]}
 * />
 * ```
 */
export function FigureList({ rows, label, columns = 'auto', className }: IFigureListProps) {
    return rows.length === 0 ? null : (
        <dl className={cn(styles.list, columns === 'single' && styles.list__single, className)} aria-label={label}>
            {rows.map(row => (
                <div key={row.key} className={styles.row}>
                    <dt className={styles.label}>{row.label}</dt>
                    <dd className={cn(styles.value, valueToneClass[row.tone ?? 'default'])}>
                        {row.value}
                        {row.unit && <span className={styles.unit}> {row.unit}</span>}
                    </dd>
                    {row.note && <dd className={styles.note}>{row.note}</dd>}
                </div>
            ))}
        </dl>
    );
}
