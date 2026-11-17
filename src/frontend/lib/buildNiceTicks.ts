/**
 * @fileoverview Round a chart's value axis to readable tick values.
 *
 * A chart that places its ticks at even fractions of the data's range labels
 * them with values such as 407.333 and 4,020.333, which a reader takes for real
 * figures, and starts its axis at whatever the smallest value happened to be.
 * This helper picks a tick step of 1, 2, or 5 times a power of ten and widens
 * the axis out to the nearest multiples of that step, so every label is a
 * round number and the data sits inside the axis. Zero is a multiple of every
 * step, so an axis that crosses zero always labels it.
 */

/** The value range a chart draws, and the values it labels on it. */
export interface INiceAxis {
    /** Bottom of the axis. */
    min: number;
    /** Top of the axis. */
    max: number;
    /** Tick values from bottom to top, each a multiple of the step. */
    ticks: number[];
}

/** Options for {@link buildNiceTicks}. */
export interface INiceTicksOptions {
    /**
     * Roughly how many intervals the axis should have. The result has between
     * about two-thirds and twice this many, because the step snaps to a round
     * number. Defaults to 3.
     */
    targetIntervals?: number;
    /** Keep `min` as the bottom of the axis, for a caller that fixed it, instead of rounding it down. */
    keepMin?: boolean;
    /** Keep `max` as the top of the axis, for a caller that fixed it, instead of rounding it up. */
    keepMax?: boolean;
}

/**
 * Drop the floating-point noise that repeated multiplication leaves in a tick
 * value, so 0.1 × 3 labels as 0.3 rather than 0.30000000000000004, and turn
 * negative zero into zero so it never labels as "-0".
 */
function clean(value: number): number {
    return Number(value.toPrecision(12)) + 0;
}

/**
 * Round a raw step to 1, 2, or 5 times a power of ten, choosing whichever is
 * nearest on a logarithmic scale, so the tick count stays close to the target.
 */
function niceStep(raw: number): number {
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const residual = raw / magnitude;
    const nice = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
    return nice * magnitude;
}

/**
 * Build a value axis with round tick values that covers `min` to `max`.
 *
 * @param min - The smallest value the axis must show.
 * @param max - The largest value the axis must show. Must be greater than `min`.
 * @param options - The target interval count, and whether either end is fixed by the caller.
 * @returns The axis bounds and its tick values, bottom to top.
 */
export function buildNiceTicks(min: number, max: number, options: INiceTicksOptions = {}): INiceAxis {
    const span = max - min;
    const step = niceStep(span > 0 ? span / (options.targetIntervals ?? 3) : Math.abs(max) || 1);
    const lower = options.keepMin ? min : Math.floor(min / step + 1e-9) * step;
    const upper = options.keepMax ? max : Math.ceil(max / step - 1e-9) * step;
    const first = Math.ceil(lower / step - 1e-9);
    const last = Math.floor(upper / step + 1e-9);
    const ticks: number[] = [];
    for (let index = first; index <= last; index += 1) {
        ticks.push(clean(index * step));
    }
    return { min: clean(lower), max: clean(upper), ticks };
}
