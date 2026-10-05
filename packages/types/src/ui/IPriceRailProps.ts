/**
 * Published props contract for the `PriceRail` exposed to plugins on
 * `context.charts.PriceRail`.
 *
 * Declared here rather than beside the component so core and plugins share one
 * copy of the shape. See `ISkeletonProps` for why a second hand-written copy is
 * avoided.
 */
import type { IPriceRailTick } from './IPriceRailTick.js';
import type { IPriceRailMarker } from './IPriceRailMarker.js';

/**
 * The `PriceRail` surface published to plugins.
 *
 * A price rail places listed values (ticks) and observed values (markers) on
 * one horizontal linear scale, with the span between the lowest and highest
 * tick shaded. It answers "where does what people actually paid sit among the
 * options on offer" at a glance, which two side-by-side numbers cannot.
 *
 * The rail knows nothing about currencies or units. Every value is a plain
 * number on one axis and the caller supplies the formatting, so the same chart
 * serves any listed-against-observed comparison.
 */
export interface IPriceRailProps {
    /** Listed values, in any order. The shaded band runs from the lowest to the highest. */
    ticks: IPriceRailTick[];

    /** Observed values to pin on the rail. Each takes its own label line, so two close markers never overlap. */
    markers: IPriceRailMarker[];

    /** Formats a value for display. Supplied by the caller so the rail stays unit-agnostic. */
    formatValue: (value: number) => string;

    /** What the shaded band represents, for the caption under the rail. */
    bandLabel: string;

    /** The unit every value is in, for the caption and the tick tooltips. */
    unit: string;

    /** Accessible name for the figure as a whole. */
    label: string;
}
