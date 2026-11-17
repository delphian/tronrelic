'use client';

/**
 * @fileoverview One collection or table in a storage browser's inventory, with
 * the detail row that opens beneath it.
 *
 * Both browsers render their rows through this, so the expand control, the
 * shortened name, the figure columns, and the stacked heading-line summary are
 * built once. At full width the figures sit in their own columns. While rows
 * are stacked they are hidden and repeated after the name as one muted line,
 * because labelled fields take a line each on a phone and made every row four
 * lines tall.
 */

import { Fragment, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tr, Td } from '../../../../components/ui/Table';
import { cn } from '../../../../lib/cn';
import styles from './InventoryTable.module.scss';

/**
 * One figure of an inventory row, such as a document count or a stored size.
 */
export interface IInventoryFigure {
    /** The column this figure belongs to, used as its React key. */
    key: string;

    /** The value shown in the figure's column at full width. */
    value: ReactNode;

    /**
     * The same value as a short phrase for the stacked heading line, such as
     * "64 docs". It carries its own unit or noun because no column header is
     * shown while rows are stacked.
     */
    summary: string;

    /** Right-align in tabular figures. Mirror the column's `numeric` setting. */
    numeric?: boolean;

    /** Extra class for the cell, for a column with its own type, such as a no-wrap token. */
    className?: string;
}

/**
 * Props for one inventory row.
 */
interface IInventoryRowProps {
    /**
     * The full stored name. Shown as a tooltip when `label` is shorter, so an
     * operator can still read the exact name a scoped browser abbreviates.
     */
    name: string;

    /** The text shown for the row, normally the name with the browser's prefix removed. */
    label: string;

    /** Whether the detail row is open. */
    expanded: boolean;

    /** Open or close the detail row. */
    onToggle(): void;

    /** The row's figures, in the same order as the table's columns after the name. */
    figures: ReadonlyArray<IInventoryFigure>;

    /** What the detail row shows while `expanded`, such as the documents of a collection. */
    children?: ReactNode;
}

/**
 * Render one inventory row, and its detail row while it is open.
 *
 * The whole row is clickable for pointer users. The expand button at the start
 * of the name cell is the keyboard's way in, so the row itself stays out of the
 * tab order and the keyboard reaches the toggle once rather than twice.
 *
 * The button shares the name's cell rather than having one of its own. When
 * the rows stack on a phone they become wrapping lines, and a separate name
 * cell too wide to fit beside the button dropped to the next line, leaving the
 * button alone on a line of its own above every long name.
 *
 * @param props - The row's names, open state, toggle, figures, and detail content.
 * @returns The row, followed by its detail row while open.
 */
export function InventoryRow({ name, label, expanded, onToggle, figures, children }: IInventoryRowProps) {
    return (
        <>
            <Tr isExpanded={expanded} onClick={onToggle} tabIndex={-1}>
                <Td>
                    <span className={styles.name_cell}>
                        {/* Stops the click from also reaching the row's handler,
                          * which would toggle the row a second time and undo it. */}
                        <button
                            type="button"
                            className={styles.expand_button}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggle();
                            }}
                        >
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <span className={styles.name_line}>
                            <code className={styles.name} title={label !== name ? name : undefined}>
                                {label}
                            </code>
                            <span className={styles.entry_summary}>
                                {figures.map((figure, index) => (
                                    <Fragment key={figure.key}>
                                        {index > 0 && ' · '}
                                        <span className={styles.entry_summary_part}>{figure.summary}</span>
                                    </Fragment>
                                ))}
                            </span>
                        </span>
                    </span>
                </Td>
                {figures.map((figure) => (
                    <Td
                        key={figure.key}
                        muted
                        numeric={figure.numeric}
                        className={cn(styles.figure_cell, figure.className)}
                    >
                        {figure.value}
                    </Td>
                ))}
            </Tr>

            {expanded && (
                <Tr className={styles.detail_row}>
                    <Td colSpan={figures.length + 1}>{children}</Td>
                </Tr>
            )}
        </>
    );
}
