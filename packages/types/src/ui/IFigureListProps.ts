/**
 * Published props contract for the `FigureList` exposed to plugins on
 * `context.ui.FigureList`.
 *
 * Declared here rather than beside the component so core and plugins share one
 * copy of the shape. See `ISkeletonProps` for why a second hand-written copy is
 * avoided.
 */
import type { IFigureListRow } from './IFigureListRow.js';

/**
 * The `FigureList` surface published to plugins.
 *
 * A figure list lays figures out the way a statement or fact sheet does: a
 * column of labels on the left, values right-aligned in tabular figures on the
 * right, and a hairline between rows. It is the dense alternative to a band of
 * `StatTile`s, for sections with many figures, where a tile per figure would
 * spend more space on borders than on numbers.
 */
export interface IFigureListProps {
    /** The figures, in reading order. An empty array renders nothing. */
    rows: IFigureListRow[];

    /**
     * Accessible name for the list. Supply it when the list has no visible
     * heading of its own beside it, so a screen reader can announce what the
     * figures describe.
     */
    label?: string;

    /**
     * `auto` flows the rows into as many columns as the list's width allows.
     * `single` holds one column, for a list placed beside another block that
     * already sets the width.
     */
    columns?: 'auto' | 'single';

    /** Extra class for layout the caller owns. */
    className?: string;
}
