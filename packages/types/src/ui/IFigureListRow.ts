/**
 * One row of a `FigureList`, the label-and-value list published to plugins on
 * `context.ui.FigureList`.
 */
import type { ReactNode } from 'react';

/**
 * One figure in a figure list: what it measures on the left, the value on the
 * right, and an optional note under the label.
 *
 * Values arrive already formatted. Unit, precision, and locale are domain
 * decisions the caller owns, so the list never formats numbers itself.
 */
export interface IFigureListRow {
    /** Stable React key; usually the id of the measure the figure reports. */
    key: string;

    /** What the figure measures, in sentence case. */
    label: ReactNode;

    /** The figure itself, already formatted. */
    value: ReactNode;

    /** Unit shown after the value in muted type, so the number stays the loudest thing in the row. */
    unit?: string;

    /** A qualifier that keeps the figure from being read out of context. */
    note?: ReactNode;

    /**
     * Colours the value when the figure carries a verdict, such as a gap a
     * reader should notice. Leave it unset for ordinary figures; colouring
     * every row spends the signal.
     */
    tone?: 'default' | 'success' | 'warning';
}
