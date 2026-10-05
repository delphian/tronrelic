/**
 * One observed value pinned to a `PriceRail`, the scale chart published to
 * plugins on `context.charts.PriceRail`.
 */
import type { ReactNode } from 'react';

/**
 * An observed value, such as what buyers actually paid, drawn as a dot on the
 * rail with its own label line underneath.
 *
 * Markers are what the reader compares against the ticks: a marker near the
 * left end of the shaded band says buyers paid close to the cheapest listed
 * value, and one past the right end says they paid more than anything listed.
 */
export interface IPriceRailMarker {
    /** Stable React key. */
    key: string;

    /** What the marker is, shown after its value. Keep it to a few words; it takes one line under the rail. */
    label: ReactNode;

    /** Position on the axis, in the same unit as the ticks. */
    value: number;

    /** Colours the marker by verdict, such as `success` for a value the reader would welcome. */
    tone?: 'neutral' | 'success' | 'warning';
}
