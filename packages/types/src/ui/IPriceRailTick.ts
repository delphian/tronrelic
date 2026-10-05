/**
 * One listed value on a `PriceRail`, the scale chart published to plugins on
 * `context.charts.PriceRail`.
 */

/**
 * A listed value, such as one tier of a rate card.
 *
 * Ticks are drawn as marks on the rail with their label and formatted value
 * above. The shaded band runs from the lowest tick to the highest, so the
 * ticks together describe the range a seller offers.
 */
export interface IPriceRailTick {
    /** Stable React key. */
    key: string;

    /** Short name shown above the value, such as a tier's term ("10m", "1d"). */
    label: string;

    /** Position on the axis, in the same unit as every other tick and marker on the rail. */
    value: number;
}
